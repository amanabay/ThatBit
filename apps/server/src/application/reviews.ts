import { randomUUID } from "node:crypto";
import { Review, ReviewInput } from "../../../../shared/contracts/reviews.ts";
import {
  Revision,
  Message,
  Asset,
} from "../../../../shared/contracts/models.ts";
import type { Exchanges } from "./exchanges.ts";
import { Conflict } from "../domain/rules.ts";
export class Reviews {
  constructor(
    private app: Exchanges,
    private now: () => number = Date.now,
  ) {}
  latest(revisionId: string) {
    return (
      this.app.store
        .list("review-note", Review)
        .filter((r) => r.revisionId === revisionId)
        .at(-1) ?? null
    );
  }
  record(revisionId: string, input: unknown) {
    const checked = ReviewInput.parse(input);
    const revision = this.app.store.get("revision", revisionId, Revision);
    if (!revision || !this.app.media.exists(revision.assetId))
      throw new Conflict(
        "Saved recording unavailable. Restore it before reviewing.",
      );
    const result = Review.parse({
      ...checked,
      id: randomUUID(),
      revisionId,
      createdAt: new Date(this.now()).toISOString(),
    });
    this.app.store.put("review-note", result.id, result);
    return result;
  }
  export() {
    const latest = new Map<string, Review>();
    for (const review of this.app.store.list("review-note", Review))
      latest.set(review.revisionId, review);
    const examples = [...latest.values()].flatMap((review) => {
      const revision = this.app.store.get(
        "revision",
        review.revisionId,
        Revision,
      );
      if (!revision) return [];
      const message = this.app.store.get(
          "message",
          revision.messageId,
          Message,
        ),
        asset = this.app.store.get("asset", revision.assetId, Asset);
      if (!message || !asset) return [];
      return [
        {
          review,
          revision,
          message,
          fixture: asset.fixture || message.source === "fixture",
        },
      ];
    });
    return {
      formatVersion: 1,
      scope:
        "Private creator assessments of saved revisions. Captions may be corrected. These are not independent labels or an untouched ASR/matching benchmark.",
      summary: {
        reviewedRevisions: examples.length,
        fixtures: examples.filter((e) => e.fixture).length,
        recordedSources: examples.filter((e) => !e.fixture).length,
        associations: {
          correct: examples.filter((e) => e.review.association === "correct")
            .length,
          wrong: examples.filter((e) => e.review.association === "wrong")
            .length,
          unsure: examples.filter((e) => e.review.association === "unsure")
            .length,
        },
        boundaries: {
          complete: examples.filter((e) => e.review.boundaries === "complete")
            .length,
          cutOff: examples.filter((e) => e.review.boundaries === "cut-off")
            .length,
          tooWide: examples.filter((e) => e.review.boundaries === "too-wide")
            .length,
          unsure: examples.filter((e) => e.review.boundaries === "unsure")
            .length,
        },
      },
      examples,
    };
  }
}
