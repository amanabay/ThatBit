import { z } from "zod";
import { Asset, Message, Revision, Publication, Id } from "./models.ts";
import { CaptureEpoch, ObsSegment } from "./capture.ts";
import { Sync } from "./publishing.ts";
import { SuggestionProvenance } from "./assistance.ts";

export const ObsHealth = z.object({
  phase: z.enum([
    "unconfigured",
    "connecting",
    "stopped",
    "warming",
    "recording",
    "paused",
    "disconnected",
    "error",
  ]),
  audioTrack: z.number().int().min(1).max(6),
  queueDepth: z.number().int().nonnegative(),
  checkedAt: z.number().nullable(),
  lastSegmentAt: z.number().nullable(),
});
export type ObsHealth = z.infer<typeof ObsHealth>;
export const ObsInspection = z.object({
  version: z.string(),
  splitSupported: z.boolean(),
  recording: z.boolean(),
  paused: z.boolean(),
  durationMs: z.number(),
  inputKinds: z.array(z.string()),
  visibleSourceKinds: z.array(z.string()),
  windowCaptureAvailable: z.boolean(),
  audioInputs: z.array(
    z.object({
      kind: z.string(),
      muted: z.boolean(),
      volumeMul: z.number(),
      enabledTracks: z.array(z.number()),
    }),
  ),
});
export const PublicationContent = z.object({
  publicationId: Id,
  revisionId: Id,
  draftId: Id,
  title: z.string(),
  version: z.number(),
  messageId: Id,
  start: z.number(),
  end: z.number(),
});
export const StudioState = z.object({
  assets: z.array(Asset),
  messages: z.array(Message),
  twitchMessageCount: z.number().int().nonnegative().default(0),
  drafts: z.array(Revision),
  publications: z.array(Publication),
  publicationContent: z.array(PublicationContent).default([]),
  suggestionProvenance: z.array(SuggestionProvenance).default([]),
  twitch: z.string(),
  creator: z.string(),
  captures: z.array(CaptureEpoch),
  obs: z.string(),
  obsHealth: ObsHealth.optional(),
  obsSegments: z.array(ObsSegment),
  assistance: z.string(),
  readerUrl: z.string(),
  synchronization: z.array(Sync),
});
export type StudioState = z.infer<typeof StudioState>;
