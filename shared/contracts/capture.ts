import { z } from "zod";
import { Id } from "./models.ts";
export const CaptureStart = z.object({
  mime: z.enum([
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ]),
  clientWallAt: z.string().datetime(),
  clientMonotonicMs: z.number().nonnegative(),
  fixture: z.boolean().default(false),
});
export const CaptureEpoch = CaptureStart.extend({
  id: Id,
  state: z.enum(["recording", "interrupted", "finished", "discarded"]),
  createdAt: z.string(),
  nextSequence: z.number().int().nonnegative(),
  bytes: z.number().nonnegative(),
  lastArrivalAt: z.string().nullable(),
  lastClientElapsedMs: z.number().nonnegative(),
  lastTimecodeMs: z.number().nonnegative(),
  snapshotSequence: z.number().int(),
  assetId: Id.nullable(),
  reason: z.string().nullable(),
});
export const CaptureChunk = z.object({
  captureId: Id,
  sequence: z.number().int().nonnegative(),
  sha256: z.string(),
  bytes: z.number().int().positive(),
  clientElapsedMs: z.number().nonnegative(),
  timecodeMs: z.number().nonnegative(),
  receivedAt: z.string(),
});
export type CaptureEpoch = z.infer<typeof CaptureEpoch>;
export type CaptureChunk = z.infer<typeof CaptureChunk>;
