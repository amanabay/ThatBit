import { z } from "zod";
import {
  Asset,
  Message,
  Caption,
} from "../../../../shared/contracts/models.ts";
import type { Exchanges } from "./exchanges.ts";
import type { TranscriptionProvider } from "./intelligence.ts";
const Job = z.object({
  id: z.string(),
  state: z.enum(["queued", "completed", "failed"]),
  attempts: z.number(),
  nextAttempt: z.number(),
  error: z.string().nullable(),
});
export class Assistance {
  constructor(
    private app: Exchanges,
    private provider: TranscriptionProvider | undefined,
    private matcher:
      | ((
          messages: Message[],
          segments: Caption[],
        ) => Promise<
          { messageId: string; start: number; end: number; evidence: string }[]
        >)
      | undefined,
  ) {}
  status() {
    if (!this.provider || !this.matcher)
      return "Local suggestions not configured";
    const jobs = this.app.store.list("auto-job", Job);
    return `Local suggestions: ${jobs.filter((j) => j.state === "queued").length} queued · ${jobs.filter((j) => j.state === "failed").length} need manual selection`;
  }
  queue(asset: Asset) {
    if (!this.provider || !this.matcher) return;
    const full =
      this.app.store.list("auto-job", Job).filter((j) => j.state === "queued")
        .length >= 10;
    if (!this.app.store.get("auto-job", asset.id, Job))
      this.app.store.put("auto-job", asset.id, {
        id: asset.id,
        state: full ? "failed" : "queued",
        attempts: 0,
        nextAttempt: 0,
        error: full
          ? "Analysis queue full; choose a saved recording and transcribe manually."
          : null,
      });
  }
  async work() {
    if (!this.provider || !this.matcher) return;
    const job = this.app.store
      .list("auto-job", Job)
      .find((j) => j.state === "queued" && j.nextAttempt <= Date.now());
    if (!job) return;
    try {
      const a = this.app.store.get("asset", job.id, Asset);
      if (!a) throw new Error("Source missing");
      const segments = z.array(Caption).parse(
        await this.provider.transcribe(this.app.media.source(a.id), {
          start: 0,
          end: Math.min(a.duration, 180),
        }),
      );
      if (
        segments.some(
          (s) => s.end > Math.min(a.duration, 180) || s.end <= s.start,
        )
      )
        throw new Error("Invalid timing");
      const messages = this.app.state().messages.filter((m) => {
        const age = Date.parse(a.createdAt) - Date.parse(m.receivedAt);
        return !m.removed && age >= -5000 && age < 300000;
      });
      const suggestions = await this.matcher(messages, segments);
      for (const candidate of suggestions.slice(0, 1)) {
        if (
          !messages.some((m) => m.id === candidate.messageId) ||
          !segments.some(
            (s) =>
              s.start === candidate.start &&
              s.end === candidate.end &&
              s.text === candidate.evidence,
          )
        )
          throw new Error("Invalid suggestion");
        const id = "auto-" + a.id;
        if (!this.app.latest(id))
          this.app.save(id, {
            expectedVersion: 0,
            messageId: candidate.messageId,
            assetId: a.id,
            start: 0,
            end: Math.min(a.duration, 180),
            title: "Suggested exchange — preview the complete response",
            captions: segments.filter((s) => s.end <= 180),
          });
      }
      this.app.store.put("auto-job", job.id, { ...job, state: "completed" });
    } catch {
      this.app.store.put("auto-job", job.id, {
        ...job,
        state: job.attempts < 2 ? "queued" : "failed",
        attempts: job.attempts + 1,
        nextAttempt: Date.now() + 10000,
        error:
          "Automatic assistance unavailable; manual selection remains available.",
      });
    }
  }
}
