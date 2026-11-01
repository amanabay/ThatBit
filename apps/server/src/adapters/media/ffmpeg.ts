import { portraitHeader } from "../../domain/portrait.ts";
import { captionVtt } from "../../../../../shared/contracts/captions.ts";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdir,
  writeFile,
  rename,
  unlink,
  open,
  readFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type {
  Asset,
  Revision,
} from "../../../../../shared/contracts/models.ts";
import type { Media } from "../../application/ports.ts";
export function run(
  command: string,
  args: string[],
  timeout = 120000,
  signal?: AbortSignal,
  cwd?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...(signal ? { signal } : {}),
      ...(cwd ? { cwd } : {}),
    });
    let output = "";
    let error = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Media processing timed out."));
    }, timeout);
    child.stdout.on("data", (d: Buffer) => {
      if (output.length < 1000000) output += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      if (error.length < 4000) error += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else
        reject(new Error(`Media tool failed (${code}): ${error.slice(-400)}`));
    });
  });
}
const Probe = z.object({
  format: z.object({ duration: z.coerce.number().positive() }),
  streams: z.array(z.object({ codec_type: z.string() })),
});
export class FFmpegMedia implements Media {
  constructor(private root: string) {}
  source(id: string) {
    return join(this.root, `${id}.source`);
  }
  derived(id: string, kind: "video" | "portrait") {
    return join(this.root, `${id}.${kind}.webm`);
  }
  exists(id: string) {
    return existsSync(this.source(id));
  }
  async inspect(path: string) {
    return Probe.parse(
      JSON.parse(
        await run("ffprobe", [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-format_whitelist",
          "matroska,webm,mov",
          "-show_format",
          "-show_streams",
          "-of",
          "json",
          path,
        ]),
      ),
    );
  }
  async ingest(bytes: Buffer, fixture: boolean): Promise<Asset> {
    if (bytes.length > 250 * 1024 * 1024)
      throw new Error("Recording exceeds 250 MB.");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const temp = join(this.root, `${id}.tmp`);
    await writeFile(temp, bytes, { mode: 0o600, flush: true });
    try {
      const probe = await this.inspect(temp);
      if (
        probe.format.duration > 3600 ||
        !probe.streams.some((s) => s.codec_type === "video")
      )
        throw new Error("Use a video recording shorter than one hour.");
      await rename(temp, this.source(id));
      const directory = await open(this.root, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      return {
        id,
        duration: probe.format.duration,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        audio: probe.streams.some((s) => s.codec_type === "audio"),
        createdAt: new Date().toISOString(),
        fixture,
      };
    } catch (e) {
      await unlink(temp).catch(() => {});
      throw e;
    }
  }
  async render(r: Revision, id: string) {
    const out = this.derived(id, "video");
    const temp = out + "." + randomUUID() + ".tmp";
    await run("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-threads",
      "2",
      "-i",
      this.source(r.assetId),
      "-ss",
      String(r.start),
      "-t",
      String(r.end - r.start),
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-vf",
      "scale=1280:720:force_original_aspect_ratio=decrease",
      "-c:v",
      "libvpx-vp9",
      "-deadline",
      "realtime",
      "-cpu-used",
      "8",
      "-threads",
      "2",
      "-c:a",
      "libopus",
      "-f",
      "webm",
      "-y",
      temp,
    ]);
    const p = await this.inspect(temp);
    if (Math.abs(p.format.duration - (r.end - r.start)) > 0.2)
      throw new Error("Rendered interval validation failed.");
    await rename(temp, out);
  }
  async portrait(r: Revision, id: string, author: string, message: string) {
    const metrics = z
      .object({
        units: z.number().positive(),
        fallback: z.number().nonnegative(),
        widths: z.record(z.string(), z.number().nonnegative()),
      })
      .parse(
        JSON.parse(
          await readFile(
            resolve("shared/assets/fonts/preview-metrics.json"),
            "utf8",
          ),
        ),
      );
    const header = portraitHeader(
      author,
      message,
      (text) =>
        Array.from(text).reduce(
          (total, character) =>
            total +
            (metrics.widths[String(character.codePointAt(0))] ??
              metrics.fallback),
          0,
        ) / metrics.units,
    );
    const font = resolve("shared/assets/fonts/ReplyLinkPreview.ttf");
    const out = this.derived(id, "portrait");
    const attempt = randomUUID();
    const temp = out + "." + attempt + ".tmp";
    const captionFile = join(this.root, id + "." + attempt + ".vtt");
    const text = join(this.root, id + "." + attempt + ".txt");
    try {
      await writeFile(captionFile, captionVtt(r.captions), { mode: 0o600 });
      await writeFile(text, header.text, { mode: 0o600 });
      await run("ffmpeg", [
        "-nostdin",
        "-v",
        "error",
        "-i",
        this.derived(id, "video"),
        "-vf",
        `scale=720:800:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:400:color=0x151020,drawtext=fontfile='${font}':textfile='${text}':expansion=none:fontcolor=white:fontsize=${header.fontSize}:line_spacing=4:x=48:y=72${r.captions.length ? `,subtitles=filename='${captionFile}':force_style='FontSize=16,MarginV=24'` : ""}`,
        "-c:v",
        "libvpx-vp9",
        "-deadline",
        "realtime",
        "-cpu-used",
        "8",
        "-threads",
        "2",
        "-c:a",
        "libopus",
        "-f",
        "webm",
        "-y",
        temp,
      ]);
      const probe = await this.inspect(temp);
      if (Math.abs(probe.format.duration - (r.end - r.start)) > 0.2)
        throw new Error("Portrait interval validation failed.");
      await rename(temp, out);
    } finally {
      await Promise.all(
        [text, captionFile, temp].map((path) => unlink(path).catch(() => {})),
      );
    }
  }
}
