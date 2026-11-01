import { Conflict } from "./rules.ts";
function wrap(text: string, width = 38) {
  return text.split("\n").flatMap((paragraph) => {
    const remaining = Array.from(paragraph),
      lines: string[] = [];
    while (remaining.length > width) {
      const space = remaining
        .slice(0, width)
        .findLastIndex((character) => /\s/.test(character));
      const length = space > 0 ? space + 1 : width;
      lines.push(remaining.splice(0, length).join(""));
    }
    lines.push(remaining.join(""));
    return lines;
  });
}
export function portraitHeader(
  author: string,
  message: string,
  measure: (text: string) => number = (text) => Array.from(text).length,
) {
  if (message.length > 400)
    throw new Conflict(
      "Portrait export supports messages up to 400 characters; use the full replay for longer context.",
    );
  const lines = [...wrap("@" + author), "", ...wrap(message)];
  if (lines.length > 18)
    throw new Conflict(
      "This message has too many lines for the portrait header. Use the full replay to preserve its complete context.",
    );
  const fontSize = Math.min(
    24,
    Math.floor(624 / Math.max(1, ...lines.map(measure))),
    Math.floor(280 / lines.length) - 4,
  );
  if (fontSize < 10)
    throw new Conflict(
      "This message cannot fit the portrait header without losing context. Use the full replay instead.",
    );
  return {
    text: lines.join("\n"),
    fontSize,
  };
}
