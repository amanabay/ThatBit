import { z } from "zod";
import { Id, Caption } from "./models.ts";
export const AnalysisJob = z.object({
  id: Id,
  revisionId: Id,
  draftId: Id,
  state: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  generation: z.number().int().positive(),
  attempts: z.number().int().nonnegative(),
  nextAttempt: z.number(),
  leaseUntil: z.number(),
  createdAt: z.string(),
  error: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
  fingerprint: z.string().nullable().default(null),
  transcriptId: Id.nullable(),
});
export const Transcript = z.object({
  id: Id,
  sourceRevisionId: Id,
  assetId: Id,
  provider: z.string(),
  model: z.string(),
  createdAt: z.string(),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  segments: z.array(Caption).max(2000),
});
export const AnalysisResult = z.object({
  job: AnalysisJob.nullable(),
  transcript: Transcript.nullable(),
  stale: z.boolean(),
  suggestions: z.array(
    z.object({
      messageId: Id,
      start: z.number(),
      end: z.number(),
      evidence: z.string(),
    }),
  ),
});
export type AnalysisJob = z.infer<typeof AnalysisJob>;
export type Transcript = z.infer<typeof Transcript>;
