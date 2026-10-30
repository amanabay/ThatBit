import { z } from "zod";
export const Resources = z.object({
  instanceId: z.string().min(1).max(100),
  rssBytes: z.number().nonnegative(),
  cpuUserMicros: z.number().nonnegative(),
  cpuSystemMicros: z.number().nonnegative(),
  uptimeSeconds: z.number().nonnegative(),
  diskFreeBytes: z.number().nonnegative(),
});
export const OperationsSnapshot = z.object({
  sampledAt: z.string().datetime(),
  scope: z.literal(
    "creator process only; excludes reader, OBS and media/model subprocess resources",
  ),
  resources: Resources,
  storage: z.object({
    sourceCount: z.number().int().nonnegative(),
    sourceBytes: z.number().nonnegative(),
  }),
  queues: z.object({
    render: z.number().int().nonnegative(),
    transcription: z.number().int().nonnegative(),
    suggestions: z.number().int().nonnegative(),
    reader: z.number().int().nonnegative(),
  }),
  failures: z.object({
    render: z.number().int().nonnegative(),
    transcription: z.number().int().nonnegative(),
    suggestions: z.number().int().nonnegative(),
    reader: z.number().int().nonnegative(),
  }),
});
export type OperationsSnapshot = z.infer<typeof OperationsSnapshot>;
