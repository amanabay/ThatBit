import {
  mkdir,
  writeFile,
  rename,
  open,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Id } from "../../../../../shared/contracts/models.ts";
import type { CaptureChunk } from "../../../../../shared/contracts/capture.ts";
import type { CaptureFiles } from "../../application/capture.ts";
import { run } from "../media/ffmpeg.ts";
import { syncDirectory } from "../storage/durability.ts";
export class LocalCaptureFiles implements CaptureFiles {
  constructor(private root: string) {}
  private dir(id: string) {
    return join(this.root, Id.parse(id));
  }
  async writeChunk(id: string, sequence: number, bytes: Buffer) {
    const dir = this.dir(id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, randomUUID() + ".tmp");
    try {
      await writeFile(temp, bytes, { mode: 0o600, flush: true });
      await rename(temp, join(dir, sequence + ".chunk"));
      await syncDirectory(dir);
    } finally {
      await rm(temp, { force: true });
    }
  }

  async assemble(id: string, chunks: CaptureChunk[]) {
    const dir = this.dir(id);
    const attempt = randomUUID();
    const source = join(dir, attempt + ".input.webm");
    const output = join(dir, attempt + ".output.webm");
    try {
      const file = await open(source, "wx", 0o600);
      try {
        for (const chunk of chunks) {
          const bytes = await readFile(join(dir, chunk.sequence + ".chunk"));
          if (
            bytes.length !== chunk.bytes ||
            createHash("sha256").update(bytes).digest("hex") !== chunk.sha256
          )
            throw new Error("Recording chunk missing or corrupt.");
          await file.writeFile(bytes);
        }
        await file.sync();
      } finally {
        await file.close();
      }
      await run("ffmpeg", [
        "-nostdin",
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "matroska,webm",
        "-i",
        source,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c",
        "copy",
        "-f",
        "webm",
        "-y",
        output,
      ]);
      if ((await stat(output)).size > 250 * 1024 * 1024)
        throw new Error("Recording too large to finalize.");
      return await readFile(output);
    } finally {
      await Promise.all(
        [source, output].map((path) => rm(path, { force: true })),
      );
    }
  }
  async remove(id: string) {
    await rm(this.dir(id), { recursive: true, force: true });
  }
}
