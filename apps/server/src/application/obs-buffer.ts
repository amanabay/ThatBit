import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Asset, Id } from "../../../../shared/contracts/models.ts";
import { ObsSegment } from "../../../../shared/contracts/capture.ts";
import type { Exchanges } from "./exchanges.ts";
import { Conflict } from "../domain/rules.ts";
import { AssemblyPin } from "./retention.ts";

// Only closed, contiguous files from one observed recording epoch can be joined.
export class ObsBuffer {
  private busy = false;
  constructor(
    private app: Exchanges,
    private assemble: (ids: string[]) => Promise<Buffer>,
  ) {}
  list() {
    return this.app.store
      .list("obs-segment", ObsSegment)
      .sort((a, b) => a.savedAt - b.savedAt);
  }
  recover() {
    for (const pin of this.app.store.list("obs-assembly-pin", AssemblyPin))
      this.app.store.delete("obs-assembly-pin", pin.id);
  }
  async snapshot(input: unknown) {
    const ids = z.array(Id).min(1).max(6).parse(input);
    if (this.busy)
      throw new Conflict("An OBS exchange is already being saved.");
    const pinId = randomUUID();
    const assets = this.app.store.transaction(() => {
      const all = this.list();
      const segments = ids.map((id) => all.find((s) => s.id === id));
      if (new Set(ids).size !== ids.length || segments.some((s) => !s))
        throw new Conflict("Choose available OBS segments without duplicates.");
      const epoch = segments[0]?.epoch;
      if (
        segments.length > 1 &&
        (!epoch ||
          segments.some(
            (s, i) =>
              s?.epoch !== epoch ||
              s.sequence !== (segments[0]?.sequence ?? 0) + i,
          ))
      )
        throw new Conflict(
          "These segments cross a recording gap. Import and review the original recording instead.",
        );
      const sources = ids.map((id) => this.app.store.get("asset", id, Asset));
      if (
        sources.some(
          (a) =>
            !a ||
            this.app.store.get("asset-deleting", a.id, z.boolean()) ||
            !this.app.media.exists(a.id),
        )
      )
        throw new Conflict(
          "OBS footage expired or is unavailable. Import the original recording.",
        );
      const available = sources.filter((a): a is Asset => Boolean(a));
      if (available.reduce((n, a) => n + a.duration, 0) > 180)
        throw new Conflict(
          "Choose up to 180 seconds of contiguous OBS footage.",
        );
      if (available.reduce((n, a) => n + a.bytes, 0) > 220 * 1024 * 1024)
        throw new Conflict(
          "Selected OBS footage exceeds 220 MB. Import a smaller recording.",
        );
      this.app.store.put("obs-assembly-pin", pinId, {
        id: pinId,
        assetIds: ids,
      });
      return available;
    });
    this.busy = true;
    try {
      return await this.app.ingest(
        await this.assemble(ids),
        assets.some((a) => a.fixture),
        "obs-assembly:" + ids.join(":"),
      );
    } finally {
      this.app.store.delete("obs-assembly-pin", pinId);
      this.busy = false;
    }
  }
}
