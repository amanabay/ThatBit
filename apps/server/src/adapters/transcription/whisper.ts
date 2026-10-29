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
        "-nostdin",
        "-v",
        "error",
        "-i",
        source,
        "-ss",
        String(interval.start),
        "-t",
        String(interval.end - interval.start),
        "-map",
        "0:a:0",
        "-vn",
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
    const audio = z
      .object({ format: z.object({ duration: z.coerce.number().positive() }) })
      .parse(
        JSON.parse(
          await run(
            "ffprobe",
            [
              "-v",
              "error",
              "-show_entries",
              "format=duration",
              "-of",
              "json",
              wav,
            ],
            120000,
            signal,
          ),
        ),
      );
    const duration = Math.min(
      interval.end - interval.start,
      audio.format.duration,
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
    // Whisper can timestamp its final sentence into its padded context, beyond
    // the supplied WAV (e.g. 31.04s for a 30s selection). Only actual extracted
    // audio is reviewable. Intersect estimated sentence times with that window;
    // application validation still rejects malformed/nonmonotonic providers.
    return parsed.transcription
      .map((s) => ({
        start: interval.start + Math.min(s.offsets.from / 1000, duration),
        end: interval.start + Math.min(s.offsets.to / 1000, duration),
        text: s.text.trim(),
      }))
      .filter((s) => s.end > s.start && s.text.length > 0);
  } finally {
    await Promise.all(
      [wav, wav + ".json"].map((f) => unlink(f).catch(() => {})),
    );
  }
}
