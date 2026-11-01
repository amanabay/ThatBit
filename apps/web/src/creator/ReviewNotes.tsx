import {
  ReviewInput,
  ReviewResult,
} from "../../../../shared/contracts/reviews.ts";
import { usePrivateReview, type PendingReview } from "./usePrivateReview.ts";
const initial = ReviewInput.parse({
  association: "unsure",
  boundaries: "unsure",
  notes: "",
});
const read = (value: unknown) => {
  const { review } = ReviewResult.parse(value);
  return review ? ReviewInput.strip().parse(review) : null;
};
const validate = (value: typeof initial) => ReviewInput.parse(value);
export function ReviewNotes({
  revisionId,
  version,
  dirty,
  onPending,
}: {
  revisionId: string;
  version: number;
  dirty: boolean;
  onPending: PendingReview;
}) {
  const form = usePrivateReview({
    id: "review:" + revisionId,
    path: "creator/reviews/" + revisionId,
    initial,
    read,
    validate,
    saved: "Private review saved for this revision.",
    onPending,
  });
  const { association, boundaries, notes } = form.input;
  const { status, busy } = form;
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
            form.update({
              association: ReviewInput.shape.association.parse(e.target.value),
            });
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
            form.update({
              boundaries: ReviewInput.shape.boundaries.parse(e.target.value),
            });
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
            form.update({ notes: e.target.value });
          }}
        />
      </label>
      <button
        className="secondary wide"
        disabled={!form.ready || busy}
        onClick={() => void form.save()}
      >
        {busy ? "Saving review…" : "Save private quality note"}
      </button>
      {dirty && (
        <p className="fine">
          This note belongs to saved revision {version}. Unsaved draft edits are
          separate; saving this note does not assess or save those edits.
        </p>
      )}
      <div className="review-note-actions">
        <button
          disabled={busy || form.loading}
          onClick={() => void form.reload()}
        >
          Reload saved quality note
        </button>
        {form.changed && (
          <button disabled={busy} onClick={form.discard}>
            Discard quality note changes
          </button>
        )}
      </div>
      {!form.ready && (
        <p className="fine">
          {form.loading
            ? "Loading saved review…"
            : "Load the saved review before saving; your typed text is kept."}
        </p>
      )}
      <p className="fine" aria-live="polite">
        {status}
      </p>
    </details>
  );
}
