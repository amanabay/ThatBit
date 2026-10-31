// All offsets refer to the approved, derived replay, never the source recording.
export function replayPosition(
  value: string | number | null,
  duration: number,
) {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    (typeof value === "string" && !/^\d{1,10}(?:\.\d{1,3})?$/.test(value))
  )
    return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? Math.max(0, Math.min(seconds, Math.max(0, duration - 0.05)))
    : 0;
}

export function replayLink(origin: string, id: string, position = 0) {
  const url = new URL("/r/" + encodeURIComponent(id), origin);
  const seconds = Math.floor(Math.max(0, position) * 10) / 10;
  if (Number.isFinite(seconds) && seconds > 0)
    url.searchParams.set("t", String(seconds));
  return url.href;
}

export function captionParts(text: string, query: string) {
  const term = query.trim();
  if (!term) return [{ text, match: false }];
  const expression = new RegExp(
    term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "gi",
  );
  const parts: { text: string; match: boolean }[] = [];
  let offset = 0;
  for (const match of text.matchAll(expression)) {
    parts.push({ text: text.slice(offset, match.index), match: false });
    parts.push({ text: match[0], match: true });
    offset = match.index + match[0].length;
  }
  parts.push({ text: text.slice(offset), match: false });
  return parts;
}
