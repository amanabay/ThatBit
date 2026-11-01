import type { Caption } from "../../../../shared/contracts/models.ts";
import { captionText, parseCaptions } from "./captions.ts";

export function transcriptCaptions(
  segments: Caption[],
  start: number,
  end: number,
) {
  return segments
    .filter((segment) => segment.start >= start && segment.end <= end)
    .map((segment) => ({
      start: Math.round((segment.start - start) * 1000) / 1000,
      end: Math.round((segment.end - start) * 1000) / 1000,
      text: segment.text,
    }));
}

export function mergeTranscriptCaptions(
  text: string,
  incoming: Caption[],
  duration: number,
) {
  const current = parseCaptions(text, duration);
  if (!current.valid)
    return {
      captions: [],
      error:
        "Finish or remove incomplete caption rows before adding transcript captions.",
    };
  const captions = [...current.captions];
  for (const caption of incoming) {
    if (
      !captions.some(
        (existing) =>
          Math.abs(existing.start - caption.start) < 0.001 &&
          Math.abs(existing.end - caption.end) < 0.001 &&
          existing.text === caption.text,
      )
    )
      captions.push(caption);
  }
  captions.sort((a, b) => a.start - b.start || a.end - b.end);
  const result = parseCaptions(captionText(captions), duration);
  return result.valid
    ? { captions, error: "" }
    : {
        captions: [],
        error:
          "Selected captions overlap existing captions or exceed the reply limits. Correct the existing rows first, or use selected sentences for the reply to replace its captions.",
      };
}

export function nextCaptionInterval(captions: Caption[], duration: number) {
  let start = 0;
  for (const caption of [...captions].sort((a, b) => a.start - b.start)) {
    if (caption.start - start >= 0.05)
      return { start, end: Math.min(start + 3, caption.start) };
    start = Math.max(start, caption.end);
  }
  return duration - start >= 0.05
    ? { start, end: Math.min(start + 3, duration) }
    : undefined;
}
