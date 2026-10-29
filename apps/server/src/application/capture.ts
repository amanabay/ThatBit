import { randomUUID, createHash } from "node:crypto";
import {
  CaptureStart,
  CaptureEpoch,
  CaptureChunk,
} from "../../../../shared/contracts/capture.ts";
import { Asset } from "../../../../shared/contracts/models.ts";
import type { Store } from "./ports.ts";
import { Conflict } from "../domain/rules.ts";
export interface CaptureFiles {
  writeChunk(captureId: string, sequence: number, bytes: Buffer): Promise<void>;
  assemble(captureId: string, chunks: CaptureChunk[]): Promise<Buffer>;
  remove(captureId: string): Promise<void>;
}
export class Captures {
  private writing = new Set<string>();
  private snapshots = new Set<string>();
  constructor(
    private store: Store,
    private files: CaptureFiles,
    private ingest: (
      bytes: Buffer,
      fixture: boolean,
      operationKey: string,
    ) => Promise<Asset>,
    private now: () => number = Date.now,
  ) {}
  list() {
    return this.store.list("capture", CaptureEpoch);
  }
  private epoch(id: string) {
    const e = this.store.get("capture", id, CaptureEpoch);
    if (!e) throw new Conflict("Recording session unavailable.");
    return e;
  }
  start(input: unknown) {
    const source = CaptureStart.parse(input);
    return this.store.transaction(() => {
      if (this.list().some((e) => e.state === "recording"))
        throw new Conflict(
          "A recording is already active. Recover or finish it before starting another.",
        );
      if (this.list().filter((e) => e.state === "interrupted").length >= 5)
        throw new Conflict("Recover or discard interrupted recordings first.");
      const e: CaptureEpoch = {
        ...source,
        id: randomUUID(),
        state: "recording",
        createdAt: new Date(this.now()).toISOString(),
        nextSequence: 0,
        bytes: 0,
        lastArrivalAt: null,
        lastClientElapsedMs: 0,
        lastTimecodeMs: 0,
        snapshotSequence: -1,
        assetId: null,
        reason: null,
      };
      this.store.put("capture", e.id, e);
      return e;
    });
  }
  async append(
    id: string,
    sequence: number,
    bytes: Buffer,
    clientElapsedMs: number,
    timecodeMs: number,
  ) {
    if (this.writing.has(id))
      throw new Conflict("Recording upload busy. Retry this same chunk.");
    if (
      !Number.isInteger(sequence) ||
      sequence < 0 ||
      !Number.isFinite(clientElapsedMs) ||
      !Number.isFinite(timecodeMs) ||
      clientElapsedMs < 0 ||
      timecodeMs < 0
    )
      throw new Conflict("Invalid recording chunk timing or sequence.");
    if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024)
      throw new Conflict("Recording chunk must be between 1 byte and 8 MB.");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const previous = this.store.get(
      "capture-chunk",
      id + "-" + sequence,
      CaptureChunk,
    );
    if (previous) {
      if (
        previous.sha256 !== hash ||
        previous.clientElapsedMs !== clientElapsedMs ||
        previous.timecodeMs !== timecodeMs
      )
        throw new Conflict("A different chunk already occupies this sequence.");
      return this.epoch(id);
    }
    const e = this.epoch(id);
    if (e.state !== "recording" || e.nextSequence !== sequence)
      throw new Conflict(
        "Recording interrupted or a chunk is missing. Recover acknowledged footage before restarting.",
      );
    if (
      clientElapsedMs < e.lastClientElapsedMs ||
      timecodeMs < e.lastTimecodeMs ||
      clientElapsedMs > 3600000 ||
      e.bytes + bytes.length > 220 * 1024 * 1024
    )
      throw new Conflict(
        "Recording limit reached or clock discontinuity detected. Stop and recover this recording.",
      );
    if (
      this.list().reduce(
        (n, c) =>
          n + (c.state === "finished" || c.state === "discarded" ? 0 : c.bytes),
        0,
      ) +
        bytes.length >
      512 * 1024 * 1024
    )
      throw new Conflict(
        "Pending recording storage is full. Recover or discard earlier captures.",
      );
    this.writing.add(id);
    try {
      await this.files.writeChunk(id, sequence, bytes);
      return this.store.transaction(() => {
        const current = this.epoch(id);
        if (current.state !== "recording" || current.nextSequence !== sequence)
          throw new Conflict("Recording changed during upload.");
        const chunk: CaptureChunk = {
          captureId: id,
          sequence,
          sha256: hash,
          bytes: bytes.length,
          clientElapsedMs,
          timecodeMs,
          receivedAt: new Date(this.now()).toISOString(),
        };
        this.store.put("capture-chunk", id + "-" + sequence, chunk);
        const next: CaptureEpoch = {
          ...current,
          nextSequence: sequence + 1,
          bytes: current.bytes + bytes.length,
          lastArrivalAt: chunk.receivedAt,
          lastClientElapsedMs: clientElapsedMs,
          lastTimecodeMs: timecodeMs,
        };
        this.store.put("capture", id, next);
        return next;
      });
    } finally {
      this.writing.delete(id);
    }
  }
  interrupt(
    id: string,
    reason = "Recording interrupted. Only acknowledged chunks can be recovered.",
  ) {
    this.store.transaction(() => {
      const e = this.epoch(id);
      if (e.state === "recording")
        this.store.put("capture", id, { ...e, state: "interrupted", reason });
    });
  }
  recover() {
    for (const e of this.list())
      if (e.state === "recording")
        this.interrupt(
          e.id,
          "App restarted. Recover acknowledged footage; the unacknowledged tail may be missing.",
        );
  }
  async snapshot(id: string, finish: boolean, expectedSequence?: number) {
    if (this.snapshots.size > 0 || this.writing.has(id))
      throw new Conflict("Recording save is busy. Try again shortly.");
    const e = this.epoch(id);
    if (expectedSequence !== undefined && expectedSequence !== e.nextSequence)
      throw new Conflict(
        "Wait until all recording chunks are acknowledged before finishing.",
      );
    if (e.state === "discarded") throw new Conflict("Recording discarded.");
    if (e.nextSequence === 0)
      throw new Conflict("No recording chunks acknowledged yet.");
    if (finish && e.state === "recording")
      this.interrupt(id, "Recording stopped. Finalizing acknowledged footage.");
    this.snapshots.add(id);
    try {
      let asset = e.assetId
        ? this.store.get("asset", e.assetId, Asset)
        : undefined;
      if (!asset || e.snapshotSequence !== e.nextSequence) {
        const chunks = this.store
          .list("capture-chunk", CaptureChunk)
          .filter((c) => c.captureId === id && c.sequence < e.nextSequence)
          .sort((a, b) => a.sequence - b.sequence);
        if (
          chunks.length !== e.nextSequence ||
          chunks.some((c, i) => c.sequence !== i)
        )
          throw new Conflict(
            "Recording has a missing chunk. Kept privately for recovery.",
          );
        const bytes = await this.files.assemble(id, chunks);
        asset = await this.ingest(
          bytes,
          e.fixture,
          `capture:${id}:${e.nextSequence}`,
        );
      }
      const finalized = asset;
      this.store.transaction(() => {
        const current = this.epoch(id);
        if (current.state === "discarded")
          throw new Conflict("Recording was discarded during save.");
        this.store.put("capture", id, {
          ...current,
          snapshotSequence: e.nextSequence,
          assetId: finalized.id,
          ...(finish
            ? {
                state: "finished",
                reason: current.state === "interrupted" ? current.reason : null,
              }
            : {}),
        });
      });
      if (finish) await this.files.remove(id);
      return finalized;
    } finally {
      this.snapshots.delete(id);
    }
  }
  async discard(id: string) {
    if (this.snapshots.size > 0 || this.writing.has(id))
      throw new Conflict("Wait for the recording save to finish.");
    const e = this.epoch(id);
    if (e.state === "recording")
      throw new Conflict("Stop recording before discarding.");
    this.store.put("capture", id, {
      ...e,
      state: "discarded",
      reason: "Creator discarded the unfinished recording.",
    });
    await this.files.remove(id);
  }
}
