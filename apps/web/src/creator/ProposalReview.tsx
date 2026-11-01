import {
  ProposalReviewInput,
  ProposalReviewResult,
} from "../../../../shared/contracts/reviews.ts";
import { usePrivateReview, type PendingReview } from "./usePrivateReview.ts";
const initial = ProposalReviewInput.parse({
  association: "unsure",
  boundaries: "unsure",
  transcript: "unchecked",
  correctionSeconds: null,
  notes: "",
});
const read = (value: unknown) => {
  const { review } = ProposalReviewResult.parse(value);
  return review ? ProposalReviewInput.strip().parse(review) : null;
};
const validate = (value: typeof initial) => ProposalReviewInput.parse(value);
export function ProposalReview({
  snapshotId,
  onPending,
}: {
  snapshotId: string;
  onPending: PendingReview;
}) {
  const form = usePrivateReview({
    id: "proposal:" + snapshotId,
    path: "creator/proposal-reviews/" + snapshotId,
    initial,
    read,
    validate,
    saved: "Original proposal assessment saved privately.",
    onPending,
  });
  const { input, status, busy, update } = form;
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
        disabled={
          busy || !form.ready || !ProposalReviewInput.safeParse(input).success
        }
        onClick={() => void form.save()}
      >
        {busy ? "Saving assessment…" : "Save original assessment"}
      </button>
      <div className="review-note-actions">
        <button
          disabled={busy || form.loading}
          onClick={() => void form.reload()}
        >
          Reload saved original assessment
        </button>
        {form.changed && (
          <button disabled={busy} onClick={form.discard}>
            Discard original assessment changes
          </button>
        )}
      </div>
      {!form.ready && (
        <p className="fine">
          {form.loading
            ? "Loading saved assessment…"
            : "Load the saved assessment before saving; your typed text is kept."}
        </p>
      )}
      <p className="fine" aria-live="polite">
        {status}
      </p>
      {!ProposalReviewInput.safeParse(input).success && (
        <p className="sample" role="alert">
          Correction time must be a whole number between 0 and 86,400 seconds,
          or left blank.
        </p>
      )}
    </details>
  );
}
