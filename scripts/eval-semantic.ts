import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { createSemanticMatcher } from "../apps/server/src/adapters/transcription/semantic.ts";
const local = existsSync(".data/models/runtime.env")
  ? parseEnv(await readFile(".data/models/runtime.env", "utf8"))
  : {};
if (existsSync(".env")) process.loadEnvFile(".env");
const path = process.env.MATCH_MODEL_DIR || local.MATCH_MODEL_DIR;
if (!path)
  throw new Error(
    "Run npm run ai:setup first, or set MATCH_MODEL_DIR to a local model.",
  );
const Row = z.object({
  id: z.string(),
  category: z.string(),
  chat: z.array(z.tuple([z.string(), z.string()])).min(1),
  speech: z.string(),
  expected: z.number().int().nonnegative().nullable(),
});
const matcher = await createSemanticMatcher(path);
const model = JSON.parse(
  await readFile(join(path, "replylink-manifest.json"), "utf8"),
) as unknown;
try {
  for (const split of ["tuning", "held-out"]) {
    const data = await readFile(`evals/semantic-${split}.json`, "utf8");
    const rows = z.array(Row).parse(JSON.parse(data));
    const cases = [];
    const started = performance.now();
    for (const row of rows) {
      const before = performance.now();
      const messages = row.chat.map(([author, text], i) => ({
        id: `m${i}`,
        sourceId: `m${i}`,
        userId: `u${i}`,
        source: "fixture" as const,
        author,
        text,
        removed: false,
        receivedAt: "2026-10-29T00:00:00.000Z",
      }));
      const suggestions = await matcher.suggest(messages, [
        { start: 0, end: 10, text: row.speech },
      ]);
      const actual = suggestions[0]?.messageId ?? null;
      cases.push({
        id: row.id,
        category: row.category,
        expected: row.expected === null ? null : `m${row.expected}`,
        actual,
        latencyMs: Math.round(performance.now() - before),
      });
    }
    const positives = cases.filter((c) => c.expected !== null).length;
    const proposed = cases.filter((c) => c.actual !== null).length;
    const correct = cases.filter(
      (c) => c.actual !== null && c.actual === c.expected,
    ).length;
    const falseAssociations = proposed - correct;
    const summary = {
      examples: cases.length,
      positiveExamples: positives,
      suggestions: proposed,
      correctAssociations: correct,
      falseAssociations,
      abstentions: cases.length - proposed,
      precision: proposed ? correct / proposed : null,
      coverage: proposed / cases.length,
      recall: correct / positives,
      totalInferenceMs: Math.round(performance.now() - started),
    };
    const report = {
      createdAt: new Date().toISOString(),
      split,
      scope:
        "Regression evaluation on inspected authored text-only examples. The original baseline is preserved separately. Not an untouched holdout, independent human labels, audio/ASR, live delay, boundary quality, or usability evidence.",
      thresholds: {
        cosine: 0.7,
        margin: 0.12,
        namedEvidenceFallback: true,
        explicitDeferralFilter: true,
      },
      datasetSha256: createHash("sha256").update(data).digest("hex"),
      model,
      summary,
      cases,
    };
    await mkdir("evals/results", { recursive: true });
    await writeFile(
      `evals/results/semantic-${split}.json`,
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(split, JSON.stringify(summary));
  }
} finally {
  await matcher.close();
}
