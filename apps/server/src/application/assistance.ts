import { z } from "zod";
import {
  Asset,
  Message,
  Caption,
  Revision,
} from "../../../../shared/contracts/models.ts";
import {
  AutoJob as Job,
  SuggestionProvenance,
} from "../../../../shared/contracts/assistance.ts";
import type { Exchanges } from "./exchanges.ts";
import type { TranscriptionProvider } from "./intelligence.ts";
import { TranscriptionAudioError } from "./transcription-error.ts";
export class Assistance {
  private busy = false;
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
    private assemble?: (ids: string[]) => Promise<Asset>,
  ) {}
  status() {
    if (!this.provider || !this.matcher)
      return "Local suggestions not configured";
    const jobs = this.app.store.list("auto-job", Job);
    return `Local suggestions: ${jobs.filter((j) => j.state === "queued").length} queued · ${jobs.filter((j) => j.state === "failed").length} need manual selection`;
  }
  queue(asset: Asset, sourceIds = [asset.id]) {
    if (!this.provider || !this.matcher) return;
    const ids = z.array(z.string()).min(1).max(6).parse(sourceIds);
    if (ids.at(-1) !== asset.id || new Set(ids).size !== ids.length)
      throw new Error("Invalid analysis source window");
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
        sourceIds: ids,
        preparedAssetId: null,
        provider: this.provider.name,
        model: this.provider.model,
      });
  }
  async work() {
    if (this.busy || !this.provider || !this.matcher) return;
    const job = this.app.store
      .list("auto-job", Job)
      .find((j) => j.state === "queued" && j.nextAttempt <= Date.now());
    if (!job) return;
    if (
      (job.provider && job.provider !== this.provider.name) ||
      (job.model && job.model !== this.provider.model)
    ) {
      this.app.store.put("auto-job", job.id, {
        ...job,
        state: "failed",
        error:
          "Local model configuration changed. Select the saved recording and transcribe it explicitly for review.",
      });
      return;
    }
    this.busy = true;
    const started = Date.now();
    this.app.diagnostics.event("info", "assistance.started", {
      jobId: job.id,
      attempt: job.attempts + 1,
    });
    try {
      const sourceIds = job.sourceIds ?? [job.id];
      let a = this.app.store.get("asset", job.preparedAssetId ?? job.id, Asset);
      if (!a) throw new Error("Source missing");
      const tail = this.app.store.get("asset", job.id, Asset);
      if (!tail) throw new Error("Source missing");
      if (sourceIds.length > 1 && !job.preparedAssetId) {
        if (!this.assemble) throw new Error("Analysis assembly unavailable");
        a = await this.assemble(sourceIds);
        const preparedId = a.id;
        job.preparedAssetId = preparedId;
        this.app.store.transaction(() => {
          this.app.store.put("analysis-source", preparedId, {
            id: preparedId,
            savedAt: Date.now(),
          });
          this.app.store.put("auto-job", job.id, job);
        });
      }
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
        const age = Date.parse(tail.createdAt) - Date.parse(m.receivedAt);
        return !m.removed && age >= -5000 && age < 300000;
      });
      const suggestions = await this.matcher(messages, segments);
      let saved = 0;
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
        const id = "auto-" + job.id;
        // Overlapping rolling windows must not repeatedly suggest the same
        // original message, including a suggestion the creator discarded.
        const prior = this.app.store
          .list("revision", Revision)
          .some(
            (r) =>
              r.draftId.startsWith("auto-") &&
              r.messageId === candidate.messageId,
          );
        if (!this.app.latest(id) && !prior) {
          this.app.save(id, {
            expectedVersion: 0,
            messageId: candidate.messageId,
            assetId: a.id,
            start: 0,
            end: Math.min(a.duration, 180),
            title: "Suggested exchange — review the response boundaries",
            captions: segments.filter((s) => s.end <= 180),
          });
          this.app.store.put(
            "suggestion-provenance",
            id,
            SuggestionProvenance.parse({
              draftId: id,
              assetId: a.id,
              sourceAssetIds: sourceIds,
              evidenceStart: candidate.start,
              evidenceEnd: candidate.end,
              provider: this.provider.name,
              model: this.provider.model,
            }),
          );
          saved++;
        }
      }
      this.app.store.put("auto-job", job.id, { ...job, state: "completed" });
      this.app.diagnostics.event("info", "assistance.completed", {
        jobId: job.id,
        count: saved,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      const audio = error instanceof TranscriptionAudioError;
      const retry = !audio && job.attempts < 2;
      this.app.diagnostics.event(
        "error",
        "assistance.failed",
        {
          jobId: job.id,
          retry,
          attempt: job.attempts + 1,
          durationMs: Date.now() - started,
        },
        error,
      );
      this.app.store.put("auto-job", job.id, {
        ...job,
        state: retry ? "queued" : "failed",
        attempts: job.attempts + 1,
        nextAttempt: Date.now() + 10000,
        error: audio
          ? error.message
          : "Automatic assistance unavailable; manual selection remains available.",
      });
    } finally {
      this.busy = false;
    }
  }
}
