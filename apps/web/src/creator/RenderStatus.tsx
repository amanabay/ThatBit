import type { Publication } from "../../../../shared/contracts/models.ts";
export function renderLabel(state: Publication["state"]) {
  return {
    queued: "Queued for rendering",
    rendering: "Rendering replay…",
    published: "Replay ready",
    failed: "Render failed",
    removed: "Replay removed",
  }[state];
}
export function RenderStatus({
  publication: p,
  version,
  dirty,
  busy,
  onRetry,
}: {
  publication: Publication;
  version: number;
  dirty: boolean;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <section
      className={`render-state ${p.state}`}
      aria-label="Replay rendering status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="render-state"
    >
      <div className="render-state-heading">
        <span aria-hidden="true">
          {p.state === "published"
            ? "✓"
            : p.state === "failed"
              ? "!"
              : p.state === "removed"
                ? "—"
                : "◌"}
        </span>
        <h2>{renderLabel(p.state)}</h2>
      </div>
      <p>
        Approved revision {version}
        {dirty ? ". Your unsaved edits are separate from this replay." : "."}
      </p>
      {p.state === "queued" && (
        <p>
          {p.attempts
            ? "An automatic retry is queued. "
            : "Waiting for the local renderer. "}
          You can keep working while it runs.
        </p>
      )}
      {p.state === "rendering" && (
        <>
          <div className="render-progress" aria-hidden="true" />
          <p>
            Creating a separate replay from the approved interval. Original
            footage stays unchanged.
          </p>
        </>
      )}
      {p.state === "published" && (
        <>
          <p>
            Rendered locally. Publishing to the reader and sharing in Twitch are
            separate actions.
          </p>
          <a
            className="button secondary"
            href={`/r/${p.id}`}
            target="_blank"
            rel="noreferrer"
          >
            Open rendered replay ↗
          </a>
        </>
      )}
      {p.state === "failed" && (
        <>
          <p>
            {p.error ?? "Check the source recording and FFmpeg, then retry."}
          </p>
          <button className="secondary" disabled={busy} onClick={onRetry}>
            Retry approved render
          </button>
        </>
      )}
      {p.state === "removed" && (
        <p>This approved replay is no longer available.</p>
      )}
    </section>
  );
}
