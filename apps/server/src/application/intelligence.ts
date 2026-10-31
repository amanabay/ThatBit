import { Conflict } from "../domain/rules.ts";
import { suggest } from "../domain/matching.ts";
import {
  Asset,
  Message,
  Revision,
  Caption,
} from "../../../../shared/contracts/models.ts";
import {
  AnalysisJob,
  Transcript,
} from "../../../../shared/contracts/intelligence.ts";
import { z } from "zod";
import type { Store, Media } from "./ports.ts";
import { quietDiagnostics, type Diagnostics } from "./diagnostics.ts";
import { TranscriptionAudioError } from "./transcription-error.ts";
import { SourceTranscript } from "../../../../shared/contracts/assistance.ts";
import { transcriptKey } from "./transcript-key.ts";
export type TranscriptionProvider = {
  name: string;
  model: string;
  fingerprint?: string;
  transcribe(
    source: string,
    interval: { start: number; end: number },
    signal?: AbortSignal,
  ): Promise<unknown>;
};
export class Intelligence {
  private busy = false;
  private active: { id: string; controller: AbortController } | undefined;
  constructor(
    private store: Store,
    private media: Media,
    private provider: TranscriptionProvider | undefined,
    private now: () => number = Date.now,
    private diagnostics: Diagnostics = quietDiagnostics,
  ) {}
  private revision(id: string) {
    return this.store.get("revision", id, Revision);
  }
  private allowed(r: Revision) {
    return (
      !this.store.get("discarded", r.draftId, z.boolean()) &&
      this.media.exists(r.assetId)
    );
  }
  list() {
    return this.store.list("analysis-job", AnalysisJob);
  }
  enqueue(draftId: string, expectedVersion: number) {
    if (!this.provider)
      throw new Conflict(
        "Configure WHISPER_BIN and WHISPER_MODEL for local transcription. Manual review remains available.",
      );
    const provider = this.provider;
    return this.store.transaction(() => {
      const r = this.store
        .list("revision", Revision)
        .filter((r) => r.draftId === draftId)
        .sort((a, b) => b.version - a.version)[0];
      if (!r || r.version !== expectedVersion)
        throw new Conflict(
          "This draft changed. Save and reload it before analysis.",
        );
      if (!this.allowed(r))
        throw new Conflict("Recording or draft unavailable.");
      const previous = this.store.get("analysis-job", r.id, AnalysisJob);
      if (
        previous &&
        previous.state !== "failed" &&
        previous.state !== "cancelled"
      )
        return previous;
      if (
        this.list().filter((j) => j.state === "queued" || j.state === "running")
          .length >= 10
      )
        throw new Conflict(
          "Transcription queue full. Wait or cancel another analysis.",
        );
      const job: AnalysisJob = {
        id: r.id,
        revisionId: r.id,
        draftId: r.draftId,
        state: "queued",
        generation: (previous?.generation ?? 0) + 1,
        attempts: 0,
        nextAttempt: 0,
        leaseUntil: 0,
        createdAt: new Date(this.now()).toISOString(),
        error: null,
        provider: provider.name,
        model: provider.model,
        transcriptId: null,
        fingerprint: provider.fingerprint ?? null,
      };
      this.store.put("analysis-job", job.id, job);
      this.diagnostics.event("info", "transcription.queued", {
        jobId: job.id,
        revisionId: r.id,
        generation: job.generation,
      });
      return job;
    });
  }
  cancel(id: string) {
    return this.store.transaction(() => {
      const j = this.store.get("analysis-job", id, AnalysisJob);
      if (!j) throw new Conflict("Analysis unavailable.");
      if (j.state === "completed")
        throw new Conflict("Completed transcript is immutable.");
      const result: AnalysisJob = {
        ...j,
        state: "cancelled",
        generation: j.generation + 1,
        leaseUntil: 0,
      };
      this.store.put("analysis-job", id, result);
      this.diagnostics.event("info", "transcription.cancelled", { jobId: id });
      if (this.active?.id === id) this.active.controller.abort();
      return result;
    });
  }
  result(revisionId: string) {
    const r = this.revision(revisionId);
    const job = this.store.get("analysis-job", revisionId, AnalysisJob) ?? null;
    const transcript = job?.transcriptId
      ? (this.store.get("transcript", job.transcriptId, Transcript) ?? null)
      : null;
    const latest = r
      ? this.store
          .list("revision", Revision)
          .filter((v) => v.draftId === r.draftId)
          .sort((a, b) => b.version - a.version)[0]
      : undefined;
    return {
      job,
      transcript,
      stale:
        !r ||
        latest?.id !== revisionId ||
        Boolean(r && this.store.get("discarded", r.draftId, z.boolean())),
      suggestions: transcript
        ? suggest(this.store.list("message", Message), transcript.segments)
        : [],
    };
  }
  recover() {
    this.store.transaction(() => {
      for (const j of this.list()) {
        if (j.state === "running")
          this.store.put("analysis-job", j.id, {
            ...j,
            state: j.attempts < 3 ? "queued" : "failed",
            generation: j.generation + 1,
            leaseUntil: 0,
            error:
              "Analysis interrupted. Retry retains the same source revision.",
          });
      }
    });
  }
  async work() {
    if (this.busy || !this.provider) return;
    this.busy = true;
    try {
      const j = this.list().find(
        (j) => j.state === "queued" && j.nextAttempt <= this.now(),
      );
      if (!j) return;
      const r = this.revision(j.revisionId);
      if (!r || !this.allowed(r)) {
        this.cancel(j.id);
        return;
      }
      const provider = this.provider;
      if (
        j.provider !== provider.name ||
        j.model !== provider.model ||
        (j.fingerprint && j.fingerprint !== provider.fingerprint)
      ) {
        this.diagnostics.event("warn", "transcription.model_changed", {
          jobId: j.id,
        });
        this.store.put("analysis-job", j.id, {
          ...j,
          state: "failed",
          error:
            "Transcription model changed. Retry explicitly with the current model.",
        });
        return;
      }
      const controller = new AbortController();
      this.active = { id: j.id, controller };
      const running: AnalysisJob = {
        ...j,
        state: "running",
        attempts: j.attempts + 1,
        leaseUntil: this.now() + 8 * 60 * 1000,
      };
      this.store.put("analysis-job", j.id, running);
      const started = this.now();
      this.diagnostics.event("info", "transcription.started", {
        jobId: j.id,
        revisionId: r.id,
        attempt: running.attempts,
        generation: j.generation,
      });
      try {
        const asset = this.store.get("asset", r.assetId, Asset);
        const cacheId =
          asset && provider.fingerprint
            ? transcriptKey(
                asset.id,
                asset.sha256,
                provider.name,
                provider.fingerprint,
                r.start,
                r.end,
              )
            : undefined;
        const cached = cacheId
          ? this.store.get("source-transcript", cacheId, SourceTranscript)
          : undefined;
        const output =
          cached?.segments ??
          (await provider.transcribe(
            this.media.source(r.assetId),
            {
              start: r.start,
              end: r.end,
            },
            controller.signal,
          ));
        const segments = z.array(Caption).max(2000).parse(output);
        let previous = r.start;
        for (const s of segments) {
          if (s.start < previous || s.end <= s.start || s.end > r.end + 0.04)
            throw new z.ZodError([
              {
                code: "custom",
                path: [],
                message: "Transcript timing outside source interval.",
              },
            ]);
          previous = s.end;
        }
        const current = this.store.get("analysis-job", j.id, AnalysisJob);
        if (
          current?.state !== "running" ||
          current.generation !== j.generation
        ) {
          this.diagnostics.event("info", "transcription.fenced", {
            jobId: j.id,
            generation: j.generation,
          });
          return;
        }
        if (!this.allowed(r)) {
          this.cancel(j.id);
          return;
        }
        const transcript: Transcript = {
          id: j.id + "-" + j.generation,
          sourceRevisionId: r.id,
          assetId: r.assetId,
          provider: j.provider,
          model: j.model,
          createdAt: new Date(this.now()).toISOString(),
          start: r.start,
          end: r.end,
          segments,
        };
        this.store.transaction(() => {
          if (cacheId && asset && !cached)
            this.store.put(
              "source-transcript",
              cacheId,
              SourceTranscript.parse({
                id: cacheId,
                assetId: asset.id,
                checksum: asset.sha256,
                provider: provider.name,
                model: provider.fingerprint,
                start: r.start,
                end: r.end,
                segments: segments.map((s, i) => ({
                  ...s,
                  id: "sentence-" + i,
                })),
              }),
            );
          this.store.put("transcript", transcript.id, transcript);
          this.store.put("analysis-job", j.id, {
            ...current,
            state: "completed",
            leaseUntil: 0,
            error: null,
            transcriptId: transcript.id,
          });
        });
        this.diagnostics.event("info", "transcription.completed", {
          jobId: j.id,
          count: segments.length,
          durationMs: this.now() - started,
        });
      } catch (e) {
        const current = this.store.get("analysis-job", j.id, AnalysisJob);
        if (current?.state !== "running" || current.generation !== j.generation)
          return;
        const invalid = e instanceof z.ZodError;
        const missing =
          e instanceof Error && "code" in e && e.code === "ENOENT";
        const audio = e instanceof TranscriptionAudioError;
        const retry = !invalid && !missing && !audio && current.attempts < 3;
        this.diagnostics.event(
          "error",
          "transcription.failed",
          {
            jobId: j.id,
            attempt: current.attempts,
            retry,
            durationMs: this.now() - started,
          },
          e,
        );
        this.store.put("analysis-job", j.id, {
          ...current,
          state: retry ? "queued" : "failed",
          leaseUntil: 0,
          nextAttempt: this.now() + current.attempts * 5000,
          error: audio
            ? e.message
            : invalid
              ? "Provider returned invalid transcript or timing. Manual review remains available."
              : missing
                ? "Local transcription executable or model unavailable. Check configuration and retry."
                : "Local transcription failed. Check source/audio and provider configuration.",
        });
      }
    } finally {
      this.busy = false;
      this.active = undefined;
    }
  }
}
