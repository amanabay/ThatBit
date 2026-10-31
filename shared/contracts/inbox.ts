import { z } from "zod";
import { Message } from "./models.ts";
export const InboxQuery = z.object({
  query: z.string().max(100).default(""),
  source: z.enum(["all", "twitch", "manual", "fixture"]).default("all"),
  removed: z.enum(["true", "false"]).default("false"),
  before: z.coerce.number().int().positive().safe().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type InboxQuery = z.infer<typeof InboxQuery>;
export const InboxPage = z.object({
  items: z.array(Message).max(100),
  nextCursor: z.number().int().positive().nullable(),
  total: z.number().int().nonnegative(),
});
export type InboxPage = z.infer<typeof InboxPage>;
export const MessageResult = z.object({ message: Message.nullable() });
