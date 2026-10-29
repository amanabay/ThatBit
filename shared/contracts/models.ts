import { z } from "zod";
export const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const Message = z.object({
  id: Id,
  sourceId: z.string(),
  userId: z.string(),
  author: z.string().min(1).max(80),
  text: z.string().min(1).max(2000),
  receivedAt: z.string(),
  source: z.enum(["fixture", "twitch", "manual"]),
  removed: z.boolean().default(false),
});
export const Asset = z.object({
  id: Id,
  duration: z.number().positive().max(3600),
  bytes: z.number(),
  sha256: z.string(),
  audio: z.boolean(),
  createdAt: z.string(),
  fixture: z.boolean(),
});
export const Caption = z.object({
  start: z.number().nonnegative(),
  end: z.number().positive(),
  text: z.string().max(500),
});
export const Revision = z.object({
  id: Id,
  draftId: Id,
  version: z.number().int().positive(),
  messageId: Id,
  assetId: Id,
  start: z.number().nonnegative(),
  end: z.number().positive(),
  title: z.string().min(1).max(120),
  captions: z.array(Caption).max(300),
  createdAt: z.string(),
});
export const Publication = z.object({
  id: Id,
  revisionId: Id,
  state: z.enum(["queued", "rendering", "published", "failed", "removed"]),
  generation: z.number(),
  creator: z.string().default("creator"),
  createdAt: z.string(),
  error: z.string().nullable(),
  attempts: z.number(),
  nextAttempt: z.number(),
  portrait: z.boolean().default(false),
});
export const Delivery = z.object({
  id: Id,
  publicationId: Id,
  state: z.enum(["sending", "sent", "held", "rejected", "failed", "uncertain"]),
  createdAt: z.string(),
});
export type Message = z.infer<typeof Message>;
export type Asset = z.infer<typeof Asset>;
export type Revision = z.infer<typeof Revision>;
export type Publication = z.infer<typeof Publication>;
export type Caption = z.infer<typeof Caption>;
export type Delivery = z.infer<typeof Delivery>;
export const Edit = Revision.pick({
  messageId: true,
  assetId: true,
  start: true,
  end: true,
  title: true,
  captions: true,
}).extend({ expectedVersion: z.number().int().nonnegative() });
export const PublicReply = z.object({
  id: Id,
  title: z.string(),
  author: z.string(),
  message: z.string(),
  creator: z.string(),
  date: z.string(),
  duration: z.number(),
  fixture: z.boolean(),
  captions: z.array(Caption),
});
export type PublicReply = z.infer<typeof PublicReply>;
