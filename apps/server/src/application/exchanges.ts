import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  Asset,
  Message,
  Revision,
  Publication,
  Edit,
  PublicReply,
} from "../../../../shared/contracts/models.ts";
import {
  Conflict,
  checkVersion,
  reviewable,
  validateInterval,
} from "../domain/rules.ts";
import type { Store, Media } from "./ports.ts";
import { quietDiagnostics, type Diagnostics } from "./diagnostics.ts";
const Approval = z.object({ revisionId: z.string(), at: z.string() });
export class Exchanges {
  constructor(
    readonly store: Store,
    readonly media: Media,
    readonly creator: string,
    readonly diagnostics: Diagnostics = quietDiagnostics,
  ) {}
  state() {
    return {
      messages: this.store.list("message", Message),
      assets: this.store.list("asset", Asset),
      drafts: this.store
        .list("revision", Revision)
        .filter(
          (r) =>
            this.latest(r.draftId)?.id === r.id &&
            !this.store.get("discarded", r.draftId, z.boolean()),
        ),
      publications: this.store.list("publication", Publication),
    };
  }
  discard(id: string) {
    if (!this.latest(id)) throw new Conflict("Draft unavailable.");
    this.store.put("discarded", id, true);
  }
  latest(id: string) {
    return this.store
      .list("revision", Revision)
      .filter((r) => r.draftId === id)
      .sort((a, b) => b.version - a.version)[0];
  }
  message(value: Message) {
    this.store.transaction(() => {
      if (
        !this.store.get("message", value.id, Message) &&
        !this.store
          .list("message", Message)
          .some(
            (m) => m.source === value.source && m.sourceId === value.sourceId,
          )
      )
        this.store.put("message", value.id, {
          ...value,
          removed:
            value.removed ||
            Boolean(
              this.store.get("removed-source", value.sourceId, z.boolean()),
            ),
        });
    });
  }
  private ingestBusy = false;
  async ingest(bytes: Buffer, fixture = false, operationKey?: string) {
    if (operationKey) {
      const existingId = this.store.get(
        "asset-operation",
        operationKey,
        z.string(),
      );
      if (existingId) {
        const existing = this.store.get("asset", existingId, Asset);
        if (!existing || !this.media.exists(existingId))
          throw new Conflict(
            "Previously saved source is unavailable. Restore it before retrying.",
          );
        return existing;
      }
    }
    if (this.ingestBusy)
      throw new Conflict("A recording is already being saved.");
    const assets = this.store.list("asset", Asset);
    if (
      assets.length >= 200 ||
      assets.reduce((n, a) => n + a.bytes, 0) + bytes.length > 5 * 1024 ** 3
    )
      throw new Conflict(
        "Local recording limit reached (200 files / 5 GB). Back up and start a new collection.",
      );
    this.ingestBusy = true;
    try {
      const asset = await this.media.ingest(bytes, fixture);
      this.store.transaction(() => {
        this.store.put("asset", asset.id, asset);
        if (operationKey)
          this.store.put("asset-operation", operationKey, asset.id);
      });
      this.diagnostics.event("info", "media.saved", {
        assetId: asset.id,
        bytes: asset.bytes,
      });
      return asset;
    } finally {
      this.ingestBusy = false;
    }
  }
  save(id: string, input: unknown) {
    const edit = Edit.parse(input);
    return this.store.transaction(() => {
      const latest = this.latest(id);
      checkVersion(latest?.version ?? 0, edit.expectedVersion);
      const message = this.store.get("message", edit.messageId, Message);
      const asset = this.store.get("asset", edit.assetId, Asset);
      if (
        !message ||
        !asset ||
        this.store.get("asset-deleting", asset.id, z.boolean()) ||
        !this.media.exists(asset.id)
      )
        throw new Conflict("Source message or recording is unavailable.");
      reviewable(message);
      validateInterval(asset, edit.start, edit.end, edit.captions);
      const revision: Revision = {
        ...edit,
        id: randomUUID(),
        draftId: id,
        version: (latest?.version ?? 0) + 1,
        createdAt: new Date().toISOString(),
      };
      this.store.put("revision", revision.id, revision);
      return revision;
    });
  }
  approve(id: string, version: number) {
    return this.store.transaction(() => {
      const r = this.latest(id);
      if (!r) throw new Conflict("Draft unavailable.");
      checkVersion(r.version, version);
      const message = this.store.get("message", r.messageId, Message);
      if (!message || !this.media.exists(r.assetId))
        throw new Conflict("Source unavailable.");
      reviewable(message);
      const existing = this.store
        .list("publication", Publication)
        .find((p) => p.revisionId === r.id);
      if (existing) return existing;
      this.store.put("approval", r.id, {
        revisionId: r.id,
        at: new Date().toISOString(),
      });
      const p: Publication = {
        id: randomUUID(),
        revisionId: r.id,
        state: "queued",
        generation: 1,
        creator: this.creator,
        createdAt: new Date().toISOString(),
        error: null,
        attempts: 0,
        nextAttempt: 0,
        portrait: false,
      };
      if (
        this.store
          .list("publication", Publication)
          .filter((p) => p.state === "queued" || p.state === "rendering")
          .length >= 10
      )
        throw new Conflict("Render queue full. Wait for existing replies.");
      this.store.put("publication", p.id, p);
      this.diagnostics.event("info", "render.queued", {
        publicationId: p.id,
        revisionId: r.id,
      });
      return p;
    });
  }
  remove(id: string) {
    this.store.transaction(() => {
      const p = this.store.get("publication", id, Publication);
      if (!p) throw new Conflict("Reply unavailable.");
      this.store.put("publication", id, {
        ...p,
        state: "removed",
        generation: p.generation + 1,
      });
      this.diagnostics.event("info", "publication.removed", {
        publicationId: id,
        generation: p.generation + 1,
      });
    });
  }
  removeMessage(sourceId: string) {
    this.store.transaction(() => {
      this.store.put("removed-source", sourceId, true);
      for (const m of this.store
        .list("message", Message)
        .filter((m) => m.sourceId === sourceId)) {
        this.store.put("message", m.id, { ...m, removed: true });
        for (const r of this.store
          .list("revision", Revision)
          .filter((r) => r.messageId === m.id)) {
          for (const p of this.store
            .list("publication", Publication)
            .filter((p) => p.revisionId === r.id))
            this.removeInTransaction(p);
        }
      }
    });
  }
  private removeInTransaction(p: Publication) {
    this.store.put("publication", p.id, {
      ...p,
      state: "removed",
      generation: p.generation + 1,
    });
  }
  recover() {
    for (const p of this.store.list("publication", Publication)) {
      if (p.state === "rendering")
        this.store.put("publication", p.id, { ...p, state: "queued" });
    }
  }
  private busy = false;
  retryRender(id: string) {
    return this.store.transaction(() => {
      const p = this.store.get("publication", id, Publication);
      if (p?.state !== "failed")
        throw new Conflict("Only a failed render can be retried.");
      const r = this.store.get("revision", p.revisionId, Revision);
      const approval = this.store.get("approval", p.revisionId, Approval);
      const m = r ? this.store.get("message", r.messageId, Message) : undefined;
      if (!r || !approval || !m || m.removed || !this.media.exists(r.assetId))
        throw new Conflict(
          "The approved source is unavailable. Restore it before retrying.",
        );
      if (
        this.store
          .list("publication", Publication)
          .filter((p) => p.state === "queued" || p.state === "rendering")
          .length >= 10
      )
        throw new Conflict("Render queue full. Wait for existing replies.");
      const next: Publication = {
        ...p,
        state: "queued",
        generation: p.generation + 1,
        attempts: 0,
        nextAttempt: 0,
        error: null,
      };
      this.store.put("publication", id, next);
      this.diagnostics.event("info", "render.retry_queued", {
        publicationId: id,
        revisionId: r.id,
        generation: next.generation,
      });
      return next;
    });
  }
  async work() {
    if (this.busy) return;
    this.busy = true;
    try {
      const p = this.store
        .list("publication", Publication)
        .find((p) => p.state === "queued" && p.nextAttempt <= Date.now());
      if (!p) return;
      const r = this.store.get("revision", p.revisionId, Revision);
      const approval = this.store.get("approval", p.revisionId, Approval);
      const m = r ? this.store.get("message", r.messageId, Message) : undefined;
      if (!r || !approval || !m || m.removed) {
        this.remove(p.id);
        return;
      }
      this.store.put("publication", p.id, {
        ...p,
        state: "rendering",
        attempts: p.attempts + 1,
      });
      const started = Date.now();
      this.diagnostics.event("info", "render.started", {
        publicationId: p.id,
        revisionId: r.id,
        attempt: p.attempts + 1,
        generation: p.generation,
      });
      try {
        await this.media.render(r, p.id);
        const current = this.store.get("publication", p.id, Publication);
        const message = this.store.get("message", r.messageId, Message);
        if (
          current?.generation === p.generation &&
          current.state === "rendering" &&
          !message?.removed
        ) {
          this.store.put("publication", p.id, {
            ...current,
            state: "published",
            error: null,
          });
          this.diagnostics.event("info", "render.completed", {
            publicationId: p.id,
            durationMs: Date.now() - started,
          });
        } else
          this.diagnostics.event("info", "render.fenced", {
            publicationId: p.id,
            generation: p.generation,
          });
      } catch (error) {
        const current = this.store.get("publication", p.id, Publication);
        this.diagnostics.event(
          "error",
          "render.failed",
          {
            publicationId: p.id,
            attempt: p.attempts + 1,
            retry:
              current?.generation === p.generation &&
              current.state === "rendering" &&
              current.attempts < 3,
            durationMs: Date.now() - started,
          },
          error,
        );
        if (
          current?.generation === p.generation &&
          current.state === "rendering"
        )
          this.store.put("publication", p.id, {
            ...current,
            state: current.attempts < 3 ? "queued" : "failed",
            nextAttempt: Date.now() + current.attempts * 5000,
            error: "Rendering failed. Check source availability and FFmpeg.",
          });
      }
    } finally {
      this.busy = false;
    }
  }
  publicReply(id: string): PublicReply | undefined {
    const p = this.store.get("publication", id, Publication);
    if (p?.state !== "published") return;
    const r = this.store.get("revision", p.revisionId, Revision);
    if (!r) return;
    const m = this.store.get("message", r.messageId, Message);
    const a = this.store.get("asset", r.assetId, Asset);
    if (!m || m.removed || !a) return;
    return PublicReply.parse({
      id,
      title: r.title,
      author: m.author,
      message: m.text,
      creator: p.creator,
      date: r.createdAt,
      duration: r.end - r.start,
      fixture: a.fixture || m.source === "fixture",
      captions: r.captions,
    });
  }
  async portrait(id: string) {
    const p = this.store.get("publication", id, Publication);
    if (p?.state !== "published" || !this.publicReply(id))
      throw new Conflict("Only a published, approved reply can be exported.");
    const r = this.store.get("revision", p.revisionId, Revision);
    const dto = this.publicReply(id);
    if (!r || !dto) throw new Conflict("Reply unavailable.");
    await this.media.portrait(r, id, dto.author, dto.message);
    const current = this.store.get("publication", id, Publication);
    if (current?.generation !== p.generation || current.state !== "published")
      throw new Conflict("Reply was removed during export.");
    this.store.put("publication", id, { ...current, portrait: true });
  }
}
