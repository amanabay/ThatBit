import { Caption } from "../../../../shared/contracts/models.ts";

export function captionRows(text: string) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [start = "", end = "", ...words] = line.split("|");
      return {
        start: start.trim(),
        end: end.trim(),
        text: words.join("|").replace(/^ /, ""),
      };
    });
}
export function captionText(captions: Caption[]) {
  return captions.map((c) => `${c.start} | ${c.end} | ${c.text}`).join("\n");
}
export function parseCaptions(text: string, duration: number) {
  const rows = captionRows(text),
    captions: Caption[] = [],
    errors: string[] = [];
  if (!Number.isFinite(duration) || duration <= 0 || duration > 180)
    errors.push("Choose a valid reply interval of up to 180 seconds.");
  if (rows.length > 300) errors.push("Use at most 300 captions.");
  let previous = 0;
  for (const [i, row] of rows.entries()) {
    const value = Caption.safeParse({
      start: row.start ? Number(row.start) : NaN,
      end: row.end ? Number(row.end) : NaN,
      text: row.text.trim(),
    });
    if (!row.start || !row.end || !row.text.trim())
      errors.push(
        `Finish each caption line as start | end | text before saving. Caption ${i + 1} is incomplete.`,
      );
    else if (!value.success || !Number.isFinite(Number(row.end)))
      errors.push(
        `Caption ${i + 1}: enter valid times and text of at most 500 characters.`,
      );
    else if (
      value.data.end <= value.data.start ||
      value.data.start < previous ||
      value.data.end > duration + 0.04
    )
      errors.push(
        `Caption ${i + 1}: times must be ordered, non-overlapping and within ${duration.toFixed(2)} seconds.`,
      );
    if (value.success) {
      captions.push(value.data);
      previous = value.data.end;
    }
  }
  return { rows, captions, errors, valid: errors.length === 0 };
}
export function rebaseCaptionText(text: string, shift: number) {
  const move = (value: string) =>
    value.trim() && Number.isFinite(Number(value))
      ? String(Math.round((Number(value) + shift) * 1000) / 1000)
      : value;
  return text
    .split("\n")
    .map((line) => {
      if (!line.trim()) return line;
      const [start = "", end = "", ...words] = line.split("|");
      return [move(start), move(end), ...words].join("|");
    })
    .join("\n");
}
