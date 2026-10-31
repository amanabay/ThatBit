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
if (!path) throw Error("Configure the verified local semantic model first.");
const Row = z.object({
  id: z.string(),
  category: z.string(),
  chat: z.array(z.tuple([z.string(), z.string()])),
  speech: z.string(),
  expected: z.number().nullable(),
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
  const data = await readFile("evals/semantic-held-out.json", "utf8");
  const rows = z.array(Row).parse(JSON.parse(data));
  const reports = [];
  for (const advanced of [false, true]) {
    matcher.clearCache();
    let correct = 0,
      wrong = 0,
      positives = 0,
      suggestions = 0;
    const latency: number[] = [];
    for (const row of rows) {
      const messages = row.chat.map(([author, text], i) => ({
        id: "m" + i,
        sourceId: "m" + i,
        userId: "u" + i,
        source: "fixture" as const,
        author,
        text,
        receivedAt: "2026-10-30",
        removed: false,
      }));
      const segments = [{ start: 0, end: 10, text: row.speech }];
      const started = performance.now();
      const result = await matcher.suggest(
        messages,
        advanced ? evidenceSpans(segments) : segments,
      );
      latency.push(performance.now() - started);
      const actual = result[0]?.messageId ?? null;
      if (row.expected !== null) positives++;
      if (actual) {
        suggestions++;
        if (actual === "m" + row.expected) correct++;
        else wrong++;
      }
    }
    latency.sort((a, b) => a - b);
    reports.push({
      policy: advanced ? "context-v2-experimental" : "baseline-v1",
      examples: rows.length,
      positiveExamples: positives,
      suggestions,
      correct,
      falseAssociations: wrong,
      precision: suggestions ? correct / suggestions : null,
      recall: positives ? correct / positives : null,
      p95MatchingMs: latency[Math.max(0, Math.ceil(latency.length * 0.95) - 1)],
    });
  }
  const result = {
    scope:
      "Comparison on the existing inspected authored single-span regression set. Each policy starts with an empty embedding cache. Not fresh frozen evaluation, independent labels, multi-answer coverage, ASR accuracy or boundary acceptance. No automatic policy activation.",
    modelFingerprint,
    execution: {
      dtype: "q8",
      device: "cpu",
      intraOpThreads: 2,
      interOpThreads: 1,
      cacheEntries: 1000,
      batchSize: 64,
    },
    datasetSha256: createHash("sha256").update(data).digest("hex"),
    reports,
  };
  await mkdir(".data/evaluations", { recursive: true, mode: 0o700 });
  await writeFile(
    ".data/evaluations/discovery-regression.json",
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await matcher.close();
}
