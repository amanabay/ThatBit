import {
  mkdtemp,
  writeFile,
  copyFile,
  rm,
  stat,
  readFile,
} from "node:fs/promises";
import { z } from "zod";
import { dirname, join, resolve } from "node:path";
import type { PublicReply } from "../../../../../shared/contracts/models.ts";
import { run } from "./ffmpeg.ts";

// The only video input is the approved, already-derived replay in the reader.
export async function shareImage(
  video: string,
  reply: PublicReply,
  output: string,
) {
  const work = await mkdtemp(join(dirname(output), "preview-"));
  try {
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
    const excerpt = (
      value: string,
      width: number,
      size: number,
      lines: number,
    ) => {
      const measure = (text: string) =>
        (Array.from(text).reduce(
          (n, c) =>
            n + (metrics.widths[String(c.codePointAt(0))] ?? metrics.fallback),
          0,
        ) /
          metrics.units) *
        size;
      const rows: string[] = [];
      let line = "";
      for (const word of value.replace(/\s+/g, " ").trim().split(" ")) {
        if (line && measure(line + " " + word) > width) {
          rows.push(line);
          line = "";
        }
        if (line) line += " ";
        for (const char of Array.from(word)) {
          if (line && measure(line + char) > width) {
            rows.push(line);
            line = "";
          }
          line += char;
        }
      }
      if (line) rows.push(line);
      if (rows.length > lines) {
        const last = Array.from(rows[lines - 1] ?? "");
        while (last.length && measure(last.join("") + "…") > width) last.pop();
        rows[lines - 1] = last.join("") + "…";
      }
      return rows.slice(0, lines).join("\n");
    };
    await copyFile(
      resolve("shared/assets/fonts/ReplyLinkPreview.ttf"),
      join(work, "font.ttf"),
    );
    for (const [name, text] of Object.entries({
      brand: "replylink / Every reply has a replay",
      author: excerpt("@" + reply.author, 372, 23, 1),
      message: excerpt(reply.message, 372, 23, 7),
      title: excerpt(reply.title, 1104, 29, 1),
      creator: excerpt(
        (reply.creator || "Creator") +
          " replied · " +
          Math.round(reply.duration) +
          "s",
        1104,
        21,
        1,
      ),
      label: reply.fixture
        ? "GENERATED SAMPLE · NOT LIVE AUDIENCE"
        : "ACTUAL RECORDED RESPONSE",
    }))
      await writeFile(join(work, name + ".txt"), text, { mode: 0o600 });
    const draw = (
      file: string,
      size: number,
      x: number,
      y: number,
      color = "0xf2edf9",
    ) =>
      `drawtext=fontfile=font.ttf:textfile=${file}.txt:expansion=none:fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}:line_spacing=9`;
    const filter = [
      "[0:v]scale=620:350:force_original_aspect_ratio=decrease,pad=620:350:(ow-iw)/2:(oh-ih)/2:color=0x09060f[frame]",
      "color=c=0x211a31:s=420x365," +
        draw("author", 23, 24, 24, "0xc2a4ff") +
        "," +
        draw("message", 23, 24, 78) +
        "[message]",
      "color=c=0x100c19:s=1200x630," +
        "drawbox=x=48:y=95:w=1104:h=1:color=0x56416e:t=fill," +
        draw("title", 29, 48, 35) +
        "," +
        draw("creator", 21, 48, 548, "0xc2a4ff") +
        "," +
        draw("brand", 14, 48, 594, "0xb8aecb") +
        "," +
        draw("label", 13, 532, 116, "0xc2a4ff") +
        "[canvas]",
      "[canvas][message]overlay=48:137[card]",
      "[card][frame]overlay=532:150:shortest=1,drawbox=x=484:y=324:w=32:h=2:color=0xb78aef:t=fill[out]",
    ].join(";");
    await run(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-threads",
        "2",
        "-i",
        resolve(video),
        "-filter_complex_threads",
        "1",
        "-filter_complex",
        filter,
        "-map",
        "[out]",
        "-frames:v",
        "1",
        "-c:v",
        "png",
        "-threads",
        "2",
        "-f",
        "image2",
        "-update",
        "1",
        "-y",
        resolve(output),
      ],
      120000,
      undefined,
      work,
    );
    if ((await stat(output)).size > 4 * 1024 * 1024)
      throw new Error("Preview exceeds its size limit");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
