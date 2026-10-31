import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createSemanticMatcher } from "../apps/server/src/adapters/transcription/semantic.ts";
import { evidenceSpans } from "../apps/server/src/domain/response-range.ts";
import { fingerprintFiles } from "../apps/server/src/adapters/transcription/fingerprint.ts";
import { join } from "node:path";
if (existsSync(".env")) process.loadEnvFile(".env");
const local = existsSync(".data/models/runtime.env")
  ? parseEnv(await readFile(".data/models/runtime.env", "utf8"))
  : {};
const path = process.env.MATCH_MODEL_DIR || local.MATCH_MODEL_DIR;
if (!path) throw Error("Configure the verified local semantic model.");
const Row = z.object({
  id: z.string(),
  category: z.string(),
  chat: z.array(z.tuple([z.string(), z.string()])),
  segments: z.array(
    z.object({ start: z.number(), end: z.number(), text: z.string() }),
  ),
  expected: z.array(z.number()),
});
const modelFingerprint = await fingerprintFiles(
  [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "onnx/model_quantized.onnx",
  ].map((file) => join(path, file)),
).catch(() => {
  throw Error(
    "Local model fingerprint unavailable. Verify the configured model files.",
  );
});
const matcher = await createSemanticMatcher(path);
try {
  const report = [];
  for (const split of ["development", "frozen"]) {
    const data = await readFile(`evals/discovery/${split}.json`, "utf8");
    const checksum = createHash("sha256").update(data).digest("hex");
    if (
      checksum !==
      (await readFile(`evals/discovery/${split}.sha256`, "utf8")).trim()
    )
      throw Error("Dataset changed after freeze");
    const rows = z
      .object({ cases: z.array(Row) })
      .parse(JSON.parse(data)).cases;
    for (const advanced of [false, true]) {
      matcher.clearCache();
      const cases = [];
      for (const row of rows) {
        const messages = row.chat.map(([author, text], i) => ({
          id: "m" + i,
          sourceId: "m" + i,
          userId: "u" + i,
          author,
          text,
          source: "fixture" as const,
          removed: false,
          receivedAt: "2026-10-30",
        }));
        const output = await matcher.suggest(
          messages,
          advanced ? evidenceSpans(row.segments) : row.segments,
        );
        const actual = [...new Set(output.map((s) => s.messageId))].slice(
            0,
            advanced ? 3 : 1,
          ),
          expected = row.expected.map((i) => "m" + i);
        cases.push({
          id: row.id,
          category: row.category,
          actual,
          expected,
          correct: actual.filter((id) => expected.includes(id)).length,
        });
      }
      const proposed = cases.reduce((n, c) => n + c.actual.length, 0),
        correct = cases.reduce((n, c) => n + c.correct, 0),
        positive = cases.reduce((n, c) => n + c.expected.length, 0);
      report.push({
        split,
        policy: advanced ? "context-v2-experimental" : "baseline-v1",
        datasetSha256: checksum,
        examples: rows.length,
        suggestions: proposed,
        correct,
        falseAssociations: proposed - correct,
        positiveAssociations: positive,
        precision: proposed ? correct / proposed : null,
        recall: positive ? correct / positive : null,
        cases,
      });
    }
  }
  await mkdir(".data/evaluations", { recursive: true, mode: 0o700 });
  await writeFile(
    ".data/evaluations/discovery-frozen.json",
    JSON.stringify(
      {
        scope:
          "Agent-authored templated cases; frozen before evaluation, not independent human validation or ASR/boundary evidence. Each policy/split starts with an empty embedding cache. No automatic policy activation.",
        modelFingerprint,
        execution: {
          dtype: "q8",
          device: "cpu",
          intraOpThreads: 2,
          interOpThreads: 1,
          cacheEntries: 1000,
          batchSize: 64,
        },
        report,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      report.map(({ cases, ...summary }) => ({
        ...summary,
        caseCount: cases.length,
      })),
      null,
      2,
    ),
  );
} finally {
  await matcher.close();
}
