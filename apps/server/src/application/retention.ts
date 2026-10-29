import { z } from "zod";
import { Revision } from "../../../../shared/contracts/models.ts";
import type { Store } from "./ports.ts";
import { ObsSegment as Segment } from "../../../../shared/contracts/capture.ts";
export const AssemblyPin = z.object({
  id: z.string(),
  assetIds: z.array(z.string()),
});
export class Retention {
  constructor(
    private store: Store,
    private removeSource: (id: string) => Promise<void>,
    private now: () => number = Date.now,
  ) {}
  async work() {
    for (const s of this.store
      .list("obs-segment", Segment)
      .filter((s) => this.now() - s.savedAt > 15 * 60000)) {
      const canDelete = this.store.transaction(() => {
        if (
          this.store
            .list("revision", Revision)
            .some((r) => r.assetId === s.id) ||
          this.store
            .list("obs-assembly-pin", AssemblyPin)
            .some((p) => p.assetIds.includes(s.id))
        )
          return false;
        const job = this.store.get(
          "auto-job",
          s.id,
          z.object({ state: z.string() }),
        );
        if (job?.state === "queued") return false;
        this.store.put("asset-deleting", s.id, true);
        return true;
      });
      if (!canDelete) continue;
      try {
        await this.removeSource(s.id);
        this.store.transaction(() => {
          this.store.delete("asset", s.id);
          this.store.delete("obs-segment", s.id);
          this.store.delete("asset-deleting", s.id);
        });
      } catch {
        this.store.put("asset-deleting", s.id, false);
      }
    }
  }
}
