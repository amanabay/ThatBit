import type { z } from "zod";
import type { Store } from "./ports.ts";
import { Asset, Publication } from "../../../../shared/contracts/models.ts";
import { AnalysisJob } from "../../../../shared/contracts/intelligence.ts";
import { AutoJob } from "../../../../shared/contracts/assistance.ts";
import { Sync } from "../../../../shared/contracts/publishing.ts";
import {
  Resources,
  OperationsSnapshot,
} from "../../../../shared/contracts/operations.ts";
export class Operations {
  constructor(
    private store: Store,
    private resources: () => Promise<z.infer<typeof Resources>>,
    private now: () => number = Date.now,
  ) {}
  async sample() {
    const resources = await this.resources();
    const assets = this.store.list("asset", Asset),
      renders = this.store.list("publication", Publication),
      analysis = this.store.list("analysis-job", AnalysisJob),
      auto = this.store.list("auto-job", AutoJob),
      reader = this.store.list("sync", Sync);
    return OperationsSnapshot.parse({
      sampledAt: new Date(this.now()).toISOString(),
      scope:
        "creator process only; excludes reader, OBS and media/model subprocess resources",
      resources,
      storage: {
        sourceCount: assets.length,
        sourceBytes: assets.reduce((n, a) => n + a.bytes, 0),
      },
      queues: {
        render: renders.filter(
          (j) => j.state === "queued" || j.state === "rendering",
        ).length,
        transcription: analysis.filter(
          (j) => j.state === "queued" || j.state === "running",
        ).length,
        suggestions: auto.filter((j) => j.state === "queued").length,
        reader: reader.filter((j) =>
          ["queued", "uploading", "removing"].includes(j.state),
        ).length,
      },
      failures: {
        render: renders.filter((j) => j.state === "failed").length,
        transcription: analysis.filter((j) => j.state === "failed").length,
        suggestions: auto.filter((j) => j.state === "failed").length,
        reader: reader.filter((j) => j.state === "failed").length,
      },
    });
  }
}
