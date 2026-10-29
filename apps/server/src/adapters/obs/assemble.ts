import {
  mkdtemp,
  copyFile,
  writeFile,
  readFile,
  rm,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { FFmpegMedia, run } from "../media/ffmpeg.ts";

export async function assembleSegments(
  ids: string[],
  source: (id: string) => string,
  scratch: string,
) {
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(join(scratch, "assembly-"));
  try {
    for (const [i, id] of ids.entries())
      await copyFile(source(id), join(temp, `${i}.webm`));
    const list = join(temp, "segments.txt");
    await writeFile(list, ids.map((_, i) => `file '${i}.webm'`).join("\n"), {
      mode: 0o600,
    });
    const output = join(temp, "exchange.webm");
    await run("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-f",
      "concat",
      "-safe",
      "1",
      "-i",
      list,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-c",
      "copy",
      "-f",
      "webm",
      "-y",
      output,
    ]);
    const media = new FFmpegMedia(temp);
    const expected = (
      await Promise.all(
        ids.map((_, i) => media.inspect(join(temp, `${i}.webm`))),
      )
    ).reduce((n, p) => n + p.format.duration, 0);
    const actual = await media.inspect(output);
    if (Math.abs(actual.format.duration - expected) > 0.25)
      throw new Error("OBS assembly duration mismatch");
    return await readFile(output);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
