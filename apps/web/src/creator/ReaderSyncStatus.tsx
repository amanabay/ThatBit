import type { Sync } from "../../../../shared/contracts/publishing.ts";
import type { Publication } from "../../../../shared/contracts/models.ts";
export function ReaderSyncStatus({
  sync,
  publications,
  content,
  busy,
  onRetry,
}: {
  sync: Sync[];
  publications: Publication[];
  content: { publicationId: string; title: string }[];
  busy: boolean;
  onRetry: (id: string) => void;
}) {
  const visible = sync
    .filter((s) => s.state !== "available")
    .toReversed()
    .sort(
      (a, b) => Number(a.state === "removed") - Number(b.state === "removed"),
    )
    .slice(0, 10);
  if (!visible.length) return null;
  return (
    <section className="reader-sync-status" aria-label="Reader synchronization">
      <h2>Reader delivery & removal</h2>
      <p className="fine">
        Local removal and reader withdrawal have separate acknowledgements.
        Failed reader work remains here until you retry it.
      </p>
      {visible.map((s) => {
        const removed =
          publications.find((p) => p.id === s.id)?.state === "removed";
        const label =
          s.state === "failed"
            ? removed
              ? "Reader removal failed — retry required"
              : "Reader publication failed — retry required"
            : s.state === "removed"
              ? "Reader removal acknowledged"
              : s.state === "removing"
                ? "Removing replay from reader…"
                : s.state === "uploading"
                  ? "Sending approved replay to reader…"
                  : removed
                    ? "Reader removal queued"
                    : "Reader publication queued";
        return (
          <div className="reader-sync-entry" key={s.id}>
            <h3>
              {content.find((c) => c.publicationId === s.id)?.title ??
                "Approved replay"}
            </h3>
            <p aria-live="polite">{label}</p>
            {s.error && <p className="sample">{s.error}</p>}
            {s.state === "failed" && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => onRetry(s.id)}
              >
                {removed ? "Retry reader removal" : "Retry reader delivery"}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
