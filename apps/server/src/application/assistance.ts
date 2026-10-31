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
  SourceTranscript,
  SuggestionSnapshot,
} from "../../../../shared/contracts/assistance.ts";
import type { Exchanges } from "./exchanges.ts";
import type { TranscriptionProvider } from "./intelligence.ts";
import { TranscriptionAudioError } from "./transcription-error.ts";
import { responseRange, evidenceSpans } from "../domain/response-range.ts";
import { Conflict } from "../domain/rules.ts";
import { transcriptKey } from "./transcript-key.ts";
import { createHash, randomUUID } from "node:crypto";
export class Assistance {
  private busy = false;
  private active: { id: string; controller: AbortController } | undefined;
  constructor(
    private app: Exchanges,
    private provider: TranscriptionProvider | undefined,
    private matcher:
      | ((
          messages: Message[],
          segments: Caption[],
        ) => Promise<
          {
            messageId: string;
            start: number;
            end: number;
            evidence: string;
            method?: "name-topic" | "meaning";
          }[]
        >)
      | undefined,
    private assemble?: (ids: string[]) => Promise<Asset>,
    private advanced = false,
  ) {}
  list() {
    return this.app.store
      .list("auto-job", Job)
      .slice(-50)
      .toReversed()
      .map((j) => ({
        id: j.id,
        generation: j.generation,
        state: j.state,
        phase: j.phase,
        outcome: j.outcome,
        error: j.error,
      }));
  }
  evidence(draftId: string) {
    const snapshot = this.app.store.get(
      "suggestion-snapshot",
      draftId,
      SuggestionSnapshot,
    );
    return {
      snapshot: snapshot ?? null,
      transcript: snapshot
        ? (this.app.store.get(
            "source-transcript",
            snapshot.transcriptId,
            SourceTranscript,
          ) ?? null)
        : null,
    };
  }
  control(id: string, generation: number, action: "cancel" | "retry") {
    const job = this.app.store.get("auto-job", id, Job);
    if (!job || job.generation !== generation)
      throw new Conflict("Analysis changed. Reload before retrying.");
    if (action === "cancel") {
      if (job.state !== "queued")
        throw new Conflict("Only pending analysis can be cancelled.");
      if (this.active?.id === id) this.active.controller.abort();
      this.app.store.put("auto-job", id, {
        ...job,
        state: "cancelled",
        generation: generation + 1,
        phase: "finished",
        error: "Analysis cancelled. Saved drafts remain protected.",
      });
    } else {
      if (
        !this.provider ||
        !this.matcher ||
        !["failed", "cancelled"].includes(job.state)
      )
        throw new Conflict("Only failed or cancelled analysis can retry.");
      if (!this.app.media.exists(job.preparedAssetId ?? id))
        throw new Conflict(
          "Recording unavailable. Restore it before retrying.",
        );
      if (
        this.app.store.list("auto-job", Job).filter((j) => j.state === "queued")
          .length >= 10
      )
        throw new Conflict("Analysis queue full.");
      this.app.store.put("auto-job", id, {
        ...job,
        state: "queued",
        generation: generation + 1,
        attempts: 0,
        nextAttempt: 0,
        phase: "waiting",
        outcome: null,
        error: null,
        provider: this.provider.name,
        model: this.provider.model,
        fingerprint: this.provider.fingerprint ?? null,
        policy: this.advanced ? "context-v2" : "baseline-v1",
      });
    }
  }
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
        fingerprint: this.provider.fingerprint ?? null,
        policy: this.advanced ? "context-v2" : "baseline-v1",
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
      (job.model && job.model !== this.provider.model) ||
      (job.fingerprint && job.fingerprint !== this.provider.fingerprint)
    ) {
      this.app.store.put("auto-job", job.id, {
        ...job,
        state: "failed",
        error:
          "Local model configuration changed. Select the saved recording and transcribe it explicitly for review.",
      });
      return;
    }
    const current = () => {
      const j = this.app.store.get("auto-job", job.id, Job);
      return j?.state === "queued" && j.generation === job.generation;
    };
    const controller = new AbortController();
    this.active = { id: job.id, controller };
    const advanced = job.policy === "context-v2";
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
        // Cancellation can finish while FFmpeg is assembling. Keep unused output
        // eligible for retention even when its generation can no longer commit.
        this.app.store.put("analysis-source", a.id, {
          id: a.id,
          savedAt: Date.now(),
        });
        if (!current()) return;
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
      job.phase = "transcribing";
      this.app.store.put("auto-job", job.id, job);
      const fingerprint = this.provider.fingerprint;
      const transcriptId = transcriptKey(
        a.id,
        a.sha256,
        this.provider.name,
        fingerprint ?? randomUUID(),
        0,
        Math.min(a.duration, 180),
      );
      const cached = fingerprint
        ? this.app.store.get(
            "source-transcript",
            transcriptId,
            SourceTranscript,
          )
        : undefined;
      const segments =
        cached?.segments ??
        z
          .array(Caption)
          .max(2000)
          .parse(
            await this.provider.transcribe(
              this.app.media.source(a.id),
              {
                start: 0,
                end: Math.min(a.duration, 180),
              },
              controller.signal,
            ),
          );
      if (!current()) return;
      let previous = 0;
      for (const segment of segments) {
        if (
          segment.start < previous ||
          segment.end > Math.min(a.duration, 180) ||
          segment.end <= segment.start
        )
          throw new Error("Invalid timing");
        previous = segment.end;
      }
      const transcript =
        cached ??
        SourceTranscript.parse({
          id: transcriptId,
          assetId: a.id,
          checksum: a.sha256,
          provider: this.provider.name,
          model: fingerprint ?? "unverified-model",
          start: 0,
          end: Math.min(a.duration, 180),
          segments: segments.map((s, i) => ({ ...s, id: "sentence-" + i })),
        });
      // Preserve actual provider output independently of corrected draft captions.
      this.app.store.put("source-transcript", transcriptId, transcript);
      job.phase = "matching";
      this.app.store.put("auto-job", job.id, job);
      const first = this.app.store.inbox({
        query: "",
        source: "all",
        removed: "false",
        limit: 100,
      });
      const recent = first.nextCursor
        ? [
            ...first.items,
            ...this.app.store.inbox({
              query: "",
              source: "all",
              removed: "false",
              limit: 100,
              before: first.nextCursor,
            }).items,
          ]
        : first.items;
      const messages = recent.toReversed().filter((m) => {
        const age =
          Date.parse(tail.createdAt) - Date.parse(m.arrivedAt ?? m.receivedAt);
        return !m.removed && age >= -5000 && age < 300000;
      });
      const spans = advanced ? evidenceSpans(segments) : segments;
      const suggestions = await this.matcher(messages, spans);
      if (!current()) return;
      let saved = 0;
      const proposals: Parameters<Exchanges["completeAutomatic"]>[1] = [];
      const selectedMessages = new Set<string>();
      job.phase = "preparing";
      this.app.store.put("auto-job", job.id, job);
      for (const candidate of suggestions) {
        if (
          !messages.some((m) => m.id === candidate.messageId) ||
          !spans.some(
            (s) =>
              s.start === candidate.start &&
              s.end === candidate.end &&
              s.text === candidate.evidence,
          )
        )
          throw new Error("Invalid suggestion");
        if (
          selectedMessages.has(candidate.messageId) ||
          saved >= (advanced ? 3 : 1)
        )
          continue;
        const id =
          "auto-" +
          (saved
            ? createHash("sha256")
                .update(job.id + ":" + candidate.messageId)
                .digest("hex")
                .slice(0, 40)
            : job.id);
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
          const range = advanced
            ? responseRange(
                segments,
                candidate.start,
                candidate.end,
                Math.min(a.duration, 180),
              )
            : { start: 0, end: Math.min(a.duration, 180), captions: segments };
          proposals.push({
            id,
            edit: {
              expectedVersion: 0,
              messageId: candidate.messageId,
              assetId: a.id,
              start: range.start,
              end: range.end,
              title: "Suggested exchange — review the response boundaries",
              captions: range.captions,
            },
            provenance: SuggestionProvenance.parse({
              draftId: id,
              assetId: a.id,
              sourceAssetIds: sourceIds,
              evidenceStart: candidate.start,
              evidenceEnd: candidate.end,
              provider: this.provider.name,
              model: this.provider.model,
            }),
            snapshot: SuggestionSnapshot.parse({
              id,
              draftId: id,
              transcriptId,
              messageId: candidate.messageId,
              evidenceIds: transcript.segments
                .filter(
                  (s) => s.start >= candidate.start && s.end <= candidate.end,
                )
                .map((s) => s.id),
              evidence: candidate.evidence,
              start: range.start,
              end: range.end,
              edge: "edge" in range && range.edge,
              method: candidate.method ?? "source-evidence",
              policy: advanced ? "context-v2-experimental" : "baseline-v1",
            }),
          });
          selectedMessages.add(candidate.messageId);
          saved++;
        }
      }
      this.app.completeAutomatic(job, proposals);
      this.app.diagnostics.event("info", "assistance.completed", {
        jobId: job.id,
        count: saved,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (!current()) return;
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
      this.active = undefined;
    }
  }
}
