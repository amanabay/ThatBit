import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../media/ffmpeg.ts";
const Result = z.object({
  transcription: z
    .array(
      z.object({
        offsets: z.object({
          from: z.number().nonnegative(),
          to: z.number().positive(),
        }),
        text: z.string().max(1000),
      }),
    )
    .max(2000),
});
export async function transcribe(
  source: string,
  root: string,
  bin: string,
  model: string,
  interval: { start: number; end: number },
  signal?: AbortSignal,
) {
  const id = randomUUID();
  const wav = join(root, id + ".wav");
  try {
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        source,
        "-ss",
        String(interval.start),
        "-t",
        String(interval.end - interval.start),
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        "-y",
        wav,
      ],
      120000,
      signal,
    );
    await run(
      bin,
      ["-m", model, "-f", wav, "-oj", "-of", wav, "-t", "2"],
      300000,
      signal,
    );
    const parsed = Result.parse(
      JSON.parse(await readFile(wav + ".json", "utf8")),
    );
    return parsed.transcription
      .map((s) => ({
        start: interval.start + s.offsets.from / 1000,
        end: interval.start + s.offsets.to / 1000,
        text: s.text.trim(),
      }))
      .filter((s) => s.end > s.start);
  } finally {
    await Promise.all(
      [wav, wav + ".json"].map((f) => unlink(f).catch(() => {})),
    );
  }
}
