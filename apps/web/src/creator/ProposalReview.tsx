import { useEffect, useState, useRef } from "react";
import {
  ProposalReviewInput,
  ProposalReviewResult,
} from "../../../../shared/contracts/reviews.ts";
import { api } from "../client.ts";
const initial = ProposalReviewInput.parse({
  association: "unsure",
  boundaries: "unsure",
  transcript: "unchecked",
  correctionSeconds: null,
  notes: "",
});
export function ProposalReview({ snapshotId }: { snapshotId: string }) {
  const [input, setInput] = useState(initial);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const touched = useRef(false);
  useEffect(() => {
    let alive = true;
    touched.current = false;
    setInput(initial);
    setStatus("");
    void api("creator/proposal-reviews/" + snapshotId)
      .then((v) => {
        const { review } = ProposalReviewResult.parse(v);
        if (alive && review && !touched.current)
          setInput(ProposalReviewInput.strip().parse(review));
      })
      .catch(() => {
        if (alive)
          setStatus(
            "Original assessment unavailable. Reopen after reconnecting.",
          );
      });
    return () => {
      alive = false;
    };
  }, [snapshotId]);
  function update(change: Partial<typeof initial>) {
    touched.current = true;
    setInput((v) => ({ ...v, ...change }));
  }
  async function save() {
    touched.current = true;
    setBusy(true);
    try {
      await api(
        "creator/proposal-reviews/" + snapshotId,
        "POST",
        ProposalReviewInput.parse(input),
      );
      setStatus("Original proposal assessment saved privately.");
    } catch {
      setStatus(
        "Could not save. Keep the original recording available and retry after reconnecting.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="review-notes">
      <summary>Assess the original suggestion</summary>
      <p className="fine">
        Watch the original proposed range and assess its untouched evidence.
        Your edited revision has separate quality notes. These are your own
        observations, not independent evaluation labels.
      </p>
      <label className="field">
        Original message connection
        <select
          aria-label="Original message connection"
          value={input.association}
          onChange={(e) =>
            update({
              association: ProposalReviewInput.shape.association.parse(
                e.target.value,
              ),
            })
          }
        >
          <option value="unsure">Not checked / unsure</option>
          <option value="correct">Correct message</option>
          <option value="wrong">Wrong message</option>
        </select>
      </label>
      <label className="field">
        Original response boundaries
        <select
          aria-label="Original response boundaries"
          value={input.boundaries}
          onChange={(e) =>
            update({
              boundaries: ProposalReviewInput.shape.boundaries.parse(
                e.target.value,
              ),
            })
          }
        >
          <option value="unsure">Not checked / unsure</option>
          <option value="complete">Complete answer</option>
          <option value="cut-off">Answer cut off</option>
          <option value="too-wide">Too much unrelated footage</option>
        </select>
      </label>
      <label className="field">
        Original transcript quality
        <select
          aria-label="Original transcript quality"
          value={input.transcript}
          onChange={(e) =>
            update({
              transcript: ProposalReviewInput.shape.transcript.parse(
                e.target.value,
              ),
            })
          }
        >
          <option value="unchecked">Not checked</option>
          <option value="accurate">Accurate</option>
          <option value="needs-correction">Needs correction</option>
          <option value="unusable">Unusable</option>
        </select>
      </label>
      <label className="field">
        Time spent correcting (seconds, optional)
        <input
          aria-label="Time spent correcting"
          type="number"
          min="0"
          max="86400"
          step="1"
          value={input.correctionSeconds ?? ""}
          onChange={(e) =>
            update({
              correctionSeconds:
                e.target.value === "" ? null : Number(e.target.value),
            })
          }
        />
      </label>
      <label className="field">
        Original proposal notes
        <textarea
          aria-label="Original proposal notes"
          maxLength={500}
          value={input.notes}
          onChange={(e) => update({ notes: e.target.value })}
        />
      </label>
      <button
        className="secondary wide"
        disabled={busy || !ProposalReviewInput.safeParse(input).success}
        onClick={() => void save()}
      >
        {busy ? "Saving assessment…" : "Save original assessment"}
      </button>
      <p className="fine" aria-live="polite">
        {status}
      </p>
    </details>
  );
}
