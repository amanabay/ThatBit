import { Publication } from "../../../../shared/contracts/models.ts";
import { Sync } from "../../../../shared/contracts/publishing.ts";
import type { Manifest } from "../../../../shared/contracts/publishing.ts";
import type { Exchanges } from "./exchanges.ts";
import { Conflict } from "../domain/rules.ts";
export interface Publisher {
  send(manifest: Omit<Manifest, "sha256" | "bytes">): Promise<void>;
  withdraw(id: string, generation: number): Promise<void>;
}
export class Publishing {
  private busy = false;
  constructor(
    private app: Exchanges,
    private publisher: Publisher | undefined,
    readonly baseUrl: string,
  ) {}
  list() {
    return this.app.store.list("sync", Sync);
  }
  queue(id: string) {
    if (!this.publisher)
      throw new Conflict("Start the local reader with npm run dev:local.");
    const p = this.app.store.get("publication", id, Publication);
    if (!p || !this.app.publicReply(id))
      throw new Conflict("Approve and render the exact revision first.");
    const old = this.app.store.get("sync", id, Sync);
    if (old && old.generation === p.generation && old.state === "available")
      return old;
    const job: Sync = {
      id,
      generation: p.generation,
      state: "queued",
      attempts: 0,
      nextAttempt: 0,
      error: null,
    };
    this.app.store.put("sync", id, job);
    return job;
  }
  retry(id: string) {
    const s = this.app.store.get("sync", id, Sync);
    if (!s) throw new Conflict("No synchronization to retry.");
    this.app.store.put("sync", id, {
      ...s,
      state: "queued",
      attempts: 0,
      nextAttempt: 0,
      error: null,
    });
  }
  recover() {
    for (const s of this.list())
      if (s.state === "uploading" || s.state === "removing")
        this.app.store.put("sync", s.id, { ...s, state: "queued" });
  }
  async work() {
    if (this.busy || !this.publisher) return;
    this.busy = true;
    try {
      for (const s of this.list()) {
        const p = this.app.store.get("publication", s.id, Publication);
        if (
          p?.state === "removed" &&
          (s.generation < p.generation ||
            (s.state !== "removed" &&
              s.state !== "failed" &&
              s.state !== "queued"))
        )
          this.app.store.put("sync", s.id, {
            ...s,
            generation: p.generation,
            state: "queued",
            attempts: 0,
            nextAttempt: 0,
          });
      }
      const s = this.list().find(
        (s) => s.state === "queued" && s.nextAttempt <= Date.now(),
      );
      if (!s) return;
      const p = this.app.store.get("publication", s.id, Publication);
      const dto = this.app.publicReply(s.id);
      const remove = !dto || p?.state === "removed";
      this.app.store.put("sync", s.id, {
        ...s,
        state: remove ? "removing" : "uploading",
      });
      try {
        if (remove) await this.publisher.withdraw(s.id, s.generation);
        else
          await this.publisher.send({ reply: dto, generation: s.generation });
        const current = this.app.store.get("publication", s.id, Publication);
        this.app.store.put("sync", s.id, {
          ...s,
          state:
            current?.generation === s.generation
              ? remove
                ? "removed"
                : "available"
              : "queued",
          attempts: s.attempts + 1,
          error: null,
        });
      } catch {
        this.app.store.put("sync", s.id, {
          ...s,
          state: s.attempts < 2 ? "queued" : "failed",
          attempts: s.attempts + 1,
          nextAttempt: Date.now() + 5000 * (s.attempts + 1),
          error:
            "Reader synchronization failed. Check reader health; retry retains the same revision.",
        });
      }
    } finally {
      this.busy = false;
    }
  }
}
