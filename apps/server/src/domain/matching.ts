import type { Caption, Message } from "../../../../shared/contracts/models.ts";
// Conservative evidence baseline; no probabilities, no clock-proximity claims.
export function suggest(messages: Message[], segments: Caption[]) {
  const results: {
    messageId: string;
    start: number;
    end: number;
    evidence: string;
  }[] = [];
  for (const s of segments) {
    const text = s.text.toLowerCase();
    const candidates = messages.filter(
      (m) =>
        !m.removed &&
        new RegExp(
          "(?:^|[^a-z0-9_])@?" +
            m.author.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
            "(?:$|[^a-z0-9_])",
        ).test(text),
    );
    if (candidates.length !== 1) continue;
    const m = candidates[0];
    if (!m) continue;
    const words = m.text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    if (
      !words.some(
        (w) =>
          ![
            "that",
            "this",
            "what",
            "with",
            "have",
            "your",
            "could",
            "would",
            "please",
          ].includes(w) && text.includes(w),
      )
    )
      continue;
    results.push({
      messageId: m.id,
      start: s.start,
      end: s.end,
      evidence: s.text,
    });
  }
  return results;
}
