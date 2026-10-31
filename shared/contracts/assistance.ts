import { z } from "zod";
import { Id } from "./models.ts";
export const AutoJob = z.object({
  id: Id,
  state: z.enum(["queued", "completed", "failed", "cancelled"]),
  policy: z.enum(["baseline-v1", "context-v2"]).default("baseline-v1"),
  generation: z.number().int().positive().default(1),
  phase: z
    .enum(["waiting", "transcribing", "matching", "preparing", "finished"])
    .default("waiting"),
  outcome: z.enum(["suggested", "abstained"]).nullable().default(null),
  attempts: z.number().int().nonnegative(),
  nextAttempt: z.number(),
  error: z.string().nullable(),
  sourceIds: z.array(Id).min(1).max(6).optional(),
  preparedAssetId: Id.nullable().default(null),
  provider: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  fingerprint: z.string().nullable().default(null),
});
export const SuggestionProvenance = z.object({
  draftId: Id,
  assetId: Id,
  sourceAssetIds: z.array(Id).min(1).max(6),
  evidenceStart: z.number().nonnegative(),
  evidenceEnd: z.number().positive(),
  provider: z.string().default("unknown"),
  model: z.string().default("unknown"),
});
export type SuggestionProvenance = z.infer<typeof SuggestionProvenance>;

export const SourceTranscript = z.object({
  id: Id,
  assetId: Id,
  checksum: z.string(),
  provider: z.string(),
  model: z.string(),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  segments: z
    .array(
      z.object({
        id: Id,
        start: z.number().nonnegative(),
        end: z.number().positive(),
        text: z.string().max(500),
      }),
    )
    .max(2000),
});
export const SuggestionSnapshot = z.object({
  id: Id,
  draftId: Id,
  transcriptId: Id,
  messageId: Id,
  evidenceIds: z.array(Id).min(1),
  evidence: z.string(),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  policy: z.string(),
  edge: z.boolean().default(false),
  method: z
    .enum(["name-topic", "meaning", "source-evidence"])
    .default("source-evidence"),
});
