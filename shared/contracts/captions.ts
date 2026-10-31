import type { Caption } from "./models.ts";
// Serialize validated plain caption text; cue markup must never change its words.
export function captionVtt(captions: Caption[], offset = 0) {
  const stamp = (seconds: number) =>
    new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23);
  const text = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/[\r\n]+/g, " ");
  return (
    "WEBVTT\n\n" +
    captions
      .map(
        (caption, i) =>
          `${i + 1}\n${stamp(offset + caption.start)} --> ${stamp(offset + caption.end)}\n${text(caption.text)}\n`,
      )
      .join("\n")
  );
}
