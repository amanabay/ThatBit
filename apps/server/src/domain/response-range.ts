import type { Caption } from "../../../../shared/contracts/models.ts";
export function responseRange(
  segments: Caption[],
  start: number,
  end: number,
  duration: number,
) {
  const first = segments.findIndex((s) => s.start === start);
  const last = segments.findLastIndex((s) => s.end === end);
  if (first < 0 || last < first)
    throw new Error("Evidence outside source transcript");
  const from = Math.max(
    0,
    (segments[Math.max(0, first - 1)]?.start ?? start) - 2,
  );
  const to = Math.min(
    duration,
    (segments[Math.min(segments.length - 1, last + 1)]?.end ?? end) + 2,
  );
  return {
    start: from,
    end: to,
    captions: segments
      .filter((s) => s.start >= from && s.end <= to)
      .map((s) => ({ ...s, start: s.start - from, end: s.end - from })),
    edge: start < 2 || end > duration - 2,
  };
}
export function evidenceSpans(segments: Caption[]) {
  const spans: Caption[] = [];
  for (let i = 0; i < segments.length; i++)
    for (let n = 1; n <= 3 && i + n <= segments.length; n++) {
      const group = segments.slice(i, i + n),
        first = group[0],
        last = group.at(-1);
      if (
        !first ||
        !last ||
        last.end - first.start > 30 ||
        group.some((s, j) => j > 0 && s.start - (group[j - 1]?.end ?? 0) > 2)
      )
        break;
      spans.push({
        start: first.start,
        end: last.end,
        text: group.map((s) => s.text).join(" "),
      });
    }
  return spans;
}
