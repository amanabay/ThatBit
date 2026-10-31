import { z } from "zod";
export const ProcessSample = z.object({
  identity: z.string().min(1).max(100),
  role: z.enum(["creator", "creator-child", "reader", "reader-child"]),
  rssBytes: z.number().nonnegative(),
  cpuMicros: z.number().nonnegative(),
});
export const Resources = z.object({
  instanceId: z.string().min(1).max(100),
  rssBytes: z.number().nonnegative(),
  cpuUserMicros: z.number().nonnegative(),
  cpuSystemMicros: z.number().nonnegative(),
  uptimeSeconds: z.number().nonnegative(),
  diskFreeBytes: z.number().nonnegative(),
  processSamples: z.array(ProcessSample).max(128).optional(),
  processesComplete: z.boolean().optional(),
  readerObserved: z.boolean().optional(),
  diskUsage: z
    .object({
      sampledAt: z.string().datetime(),
      allocatedBytes: z.number().nonnegative(),
      logicalBytes: z.number().nonnegative(),
      files: z.number().int().nonnegative(),
      complete: z.boolean(),
    })
    .optional(),
});
export const OperationsSnapshot = z.object({
  sampledAt: z.string().datetime(),
  scope: z.enum([
    "creator process only; excludes reader, OBS and media/model subprocess resources",
    "creator and sampled descendants; configured local reader; managed data disk; excludes OBS and between-sample peaks",
  ]),
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
