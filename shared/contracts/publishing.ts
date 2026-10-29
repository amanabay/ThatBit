import { z } from "zod";
import { Id, PublicReply } from "./models.ts";
export const Manifest = z.object({
  reply: PublicReply.refine(
    (r) =>
      r.duration > 0 &&
      r.duration <= 180 &&
      r.captions.every((c) => c.end > c.start && c.end <= r.duration + 0.04),
    "Invalid approved interval or captions",
  ),
  generation: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z
    .number()
    .int()
    .positive()
    .max(64 * 1024 * 1024),
});
export const RemoteRecord = z.object({
  id: Id,
  generation: z.number().int().positive(),
  state: z.enum(["staged", "available", "removed"]),
  manifest: Manifest.nullable(),
});
export const Sync = z.object({
  id: Id,
  generation: z.number(),
  state: z.enum([
    "queued",
    "uploading",
    "available",
    "removing",
    "removed",
    "failed",
  ]),
  attempts: z.number(),
  nextAttempt: z.number(),
  error: z.string().nullable(),
});
export type Manifest = z.infer<typeof Manifest>;
export type Sync = z.infer<typeof Sync>;
