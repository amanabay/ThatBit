import { randomUUID } from "node:crypto";
import { Review, ReviewInput } from "../../../../shared/contracts/reviews.ts";
import {
  Revision,
  Message,
  Asset,
} from "../../../../shared/contracts/models.ts";
import type { Exchanges } from "./exchanges.ts";
import { Conflict } from "../domain/rules.ts";
import {
  ProposalReview,
  ProposalReviewInput,
} from "../../../../shared/contracts/reviews.ts";
import {
  SourceTranscript,
  SuggestionSnapshot,
} from "../../../../shared/contracts/assistance.ts";
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
  latestProposal(snapshotId: string) {
    return (
      this.app.store
        .list("proposal-review", ProposalReview)
        .filter((r) => r.snapshotId === snapshotId)
        .at(-1) ?? null
    );
  }
  recordProposal(snapshotId: string, input: unknown) {
    const checked = ProposalReviewInput.parse(input);
    const snapshot = this.app.store.get(
      "suggestion-snapshot",
      snapshotId,
      SuggestionSnapshot,
    );
    const transcript =
      snapshot &&
      this.app.store.get(
        "source-transcript",
        snapshot.transcriptId,
        SourceTranscript,
      );
    if (!snapshot || !transcript || !this.app.media.exists(transcript.assetId))
      throw new Conflict(
        "Original suggestion recording unavailable. Restore it before assessing.",
      );
    const result = ProposalReview.parse({
      ...checked,
      id: randomUUID(),
      snapshotId,
      createdAt: new Date(this.now()).toISOString(),
    });
    this.app.store.put("proposal-review", result.id, result);
    return result;
  }
  exportProposals() {
    const latest = new Map<string, ProposalReview>();
    for (const review of this.app.store.list("proposal-review", ProposalReview))
      latest.set(review.snapshotId, review);
    const examples = [...latest.values()].flatMap((review) => {
      const snapshot = this.app.store.get(
        "suggestion-snapshot",
        review.snapshotId,
        SuggestionSnapshot,
      );
      const transcript =
        snapshot &&
        this.app.store.get(
          "source-transcript",
          snapshot.transcriptId,
          SourceTranscript,
        );
      const message =
        snapshot && this.app.store.get("message", snapshot.messageId, Message);
      const asset =
        transcript && this.app.store.get("asset", transcript.assetId, Asset);
      return snapshot && transcript && message && asset
        ? [
            {
              review,
              snapshot,
              transcript,
              message,
              fixture: asset.fixture || message.source === "fixture",
            },
          ]
        : [];
    });
    return {
      formatVersion: 1,
      scope:
        "Private creator assessments of immutable original proposals and raw ASR. Separate from corrected revisions; not independent labels. Deleted source artifacts are omitted.",
      summary: {
        assessedProposals: examples.length,
        fixtures: examples.filter((e) => e.fixture).length,
        recordedSources: examples.filter((e) => !e.fixture).length,
      },
      examples,
    };
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
