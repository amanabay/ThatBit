import { z } from "zod";
import { Id } from "./models.ts";
export const AutoJob = z.object({
  id: Id,
  state: z.enum(["queued", "completed", "failed"]),
  attempts: z.number().int().nonnegative(),
  nextAttempt: z.number(),
  error: z.string().nullable(),
  sourceIds: z.array(Id).min(1).max(6).optional(),
  preparedAssetId: Id.nullable().default(null),
  provider: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
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
