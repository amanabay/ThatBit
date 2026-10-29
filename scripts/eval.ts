import { readFile } from "node:fs/promises";
import { z } from "zod";
import { suggest } from "../apps/server/src/domain/matching.ts";
const rows = z
  .array(
    z.object({
      author: z.string(),
      message: z.string(),
      speech: z.string(),
      match: z.boolean(),
    }),
  )
  .parse(JSON.parse(await readFile("evals/held-out.json", "utf8")));
let tp = 0,
  fp = 0,
  fn = 0;
for (const r of rows) {
  const actual =
    suggest(
      [
        {
          id: "m",
          sourceId: "m",
          userId: "u",
          author: r.author,
          text: r.message,
          source: "fixture",
          receivedAt: "2026-10-29",
          removed: false,
        },
      ],
      [{ start: 0, end: 5, text: r.speech }],
    ).length > 0;
  if (actual && r.match) tp++;
  if (actual && !r.match) fp++;
  if (!actual && r.match) fn++;
}
console.log(
  JSON.stringify(
    {
      examples: rows.length,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      precision: tp / (tp + fp),
      coverage: (tp + fp) / rows.length,
      scope:
        "Small authored text-only held-out fixture; not live quality, timing, or ASR evidence.",
      latency: "not measured",
      cost: "no external calls",
    },
    null,
    2,
  ),
);
if (fp || fn) process.exitCode = 1;
