import { useEffect, useState } from "react";
import { z } from "zod";
import {
  SourceTranscript,
  SuggestionSnapshot,
} from "../../../../shared/contracts/assistance.ts";
import { api, time } from "../client.ts";
import { ProposalReview } from "./ProposalReview.tsx";
import type { PendingReview } from "./usePrivateReview.ts";
const Result = z.object({
  snapshot: SuggestionSnapshot.nullable(),
  transcript: SourceTranscript.nullable(),
});
export function SuggestionEvidence({
  draftId,
  assetId,
  onPreview,
  onPending,
}: {
  draftId: string;
  assetId: string;
  onPreview: (seconds: number, end: number) => void;
  onPending: PendingReview;
}) {
  const [result, setResult] = useState<z.infer<typeof Result>>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setResult(undefined);
    setError("");
    void api("creator/suggestions/" + draftId)
      .then((v) => {
        if (alive) setResult(Result.parse(v));
      })
      .catch(() => {
        if (alive)
          setError(
            "Original suggestion evidence could not be loaded. Your draft is still available.",
          );
      });
    return () => {
      alive = false;
    };
  }, [draftId, attempt]);
  if (error)
    return (
      <section
        className="suggestion-evidence"
        aria-label="Original suggestion evidence"
      >
        <p role="alert">{error}</p>
        <button onClick={() => setAttempt((v) => v + 1)}>
          Retry original evidence
        </button>
      </section>
    );
  if (!result?.snapshot) return null;
  const s = result.snapshot;
  const sameSource = result.transcript?.assetId === assetId;
  return (
    <section
      className="suggestion-evidence"
      aria-label="Original suggestion evidence"
    >
      <h3>Why this connection?</h3>
      <p className="fine">
        Original ASR estimate ·{" "}
        {s.method === "name-topic"
          ? "Name and topic evidence"
          : s.method === "meaning"
            ? "Meaning match"
            : "Source evidence"}
        . Verify against actual footage. Your corrections do not rewrite this
        evidence.
      </p>
      <blockquote>{s.evidence}</blockquote>
      {s.edge && (
        <p className="sample">
          Evidence reaches the edge of available footage. Preview the opening
          and ending; the answer may extend beyond this recording window.
        </p>
      )}
      <button
        disabled={!sameSource}
        className="secondary"
        onClick={() => onPreview(s.start, s.end)}
      >
        Play original proposed range · {time(s.end - s.start)}
      </button>
      {!sameSource && (
        <p className="fine">
          The edited recording differs from the original suggestion. Select its
          original source to preview this evidence.
        </p>
      )}
      <details>
        <summary>Original source transcript</summary>
        {result.transcript?.segments.map((sentence) => (
          <p key={sentence.id}>
            <button
              disabled={!sameSource}
              onClick={() => onPreview(sentence.start, sentence.end)}
            >
              {time(sentence.start)} · {sentence.text}
            </button>
          </p>
        ))}
      </details>
      <ProposalReview key={s.id} snapshotId={s.id} onPending={onPending} />
    </section>
  );
}
