import { useEffect, useState, useRef } from "react";
import {
  ReviewInput,
  ReviewResult,
  type Review,
} from "../../../../shared/contracts/reviews.ts";
import { api } from "../client.ts";
export function ReviewNotes({
  revisionId,
  version,
  dirty,
}: {
  revisionId: string;
  version: number;
  dirty: boolean;
}) {
  const [association, setAssociation] =
    useState<Review["association"]>("unsure");
  const [boundaries, setBoundaries] = useState<Review["boundaries"]>("unsure");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const current = useRef(revisionId);
  const touched = useRef(false);
  useEffect(() => {
    let alive = true;
    current.current = revisionId;
    touched.current = false;
    setBusy(false);
    setAssociation("unsure");
    setBoundaries("unsure");
    setNotes("");
    setStatus("");
    void api("creator/reviews/" + revisionId)
      .then((v) => {
        const { review } = ReviewResult.parse(v);
        if (alive && review && !touched.current) {
          setAssociation(review.association);
          setBoundaries(review.boundaries);
          setNotes(review.notes);
          setStatus("Private review saved for this revision.");
        }
      })
      .catch(() => {
        if (alive)
          setStatus(
            "Review notes unavailable. Retry when the studio reconnects.",
          );
      });
    return () => {
      alive = false;
    };
  }, [revisionId]);
  async function save() {
    touched.current = true;
    setBusy(true);
    setStatus("");
    try {
      await api(
        "creator/reviews/" + revisionId,
        "POST",
        ReviewInput.parse({ association, boundaries, notes }),
      );
      if (current.current === revisionId)
        setStatus("Private review saved for this revision.");
    } catch (e) {
      if (current.current === revisionId)
        setStatus(
          e instanceof Error ? e.message : "Review could not be saved.",
        );
    } finally {
      if (current.current === revisionId) setBusy(false);
    }
  }
  return (
    <details className="review-notes">
      <summary>Keep a private quality note · revision {version}</summary>
      <p className="fine">
        After watching, record whether this saved exchange connects the right
        message and keeps the complete answer. Notes help evaluate real use;
        they do not change the replay.
      </p>
      <label className="field">
        Message connection
        <select
          aria-label="Message connection"
          value={association}
          onChange={(e) => {
            touched.current = true;
            setAssociation(ReviewInput.shape.association.parse(e.target.value));
          }}
        >
          <option value="unsure">Not sure / not checked</option>
          <option value="correct">Correct message</option>
          <option value="wrong">Wrong message</option>
        </select>
      </label>
      <label className="field">
        Response boundaries
        <select
          aria-label="Response boundaries"
          value={boundaries}
          onChange={(e) => {
            touched.current = true;
            setBoundaries(ReviewInput.shape.boundaries.parse(e.target.value));
          }}
        >
          <option value="unsure">Not sure / not checked</option>
          <option value="complete">Complete answer</option>
          <option value="cut-off">Answer cut off</option>
          <option value="too-wide">Too much unrelated footage</option>
        </select>
      </label>
      <label className="field">
        Private review notes
        <textarea
          aria-label="Private review notes"
          value={notes}
          maxLength={500}
          onChange={(e) => {
            touched.current = true;
            setNotes(e.target.value);
          }}
        />
      </label>
      <button
        className="secondary wide"
        disabled={dirty || busy}
        onClick={() => void save()}
      >
        {busy ? "Saving review…" : "Save private quality note"}
      </button>
      {dirty && (
        <p className="fine">
          Save the draft first; this note belongs to its exact saved revision.
        </p>
      )}
      <p className="fine" aria-live="polite">
        {status}
      </p>
    </details>
  );
}
