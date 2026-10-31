import { useRef, useState, type ReactNode } from "react";
const panes = [
  { id: "response", title: "Response" },
  { id: "captions", title: "Captions" },
  { id: "evidence", title: "Evidence & notes" },
] as const;
export function ReviewTools({
  response,
  captions,
  evidence,
  captionCount,
}: {
  response: ReactNode;
  captions: ReactNode;
  evidence: ReactNode;
  captionCount: number;
}) {
  const [active, setActive] =
    useState<(typeof panes)[number]["id"]>("response");
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="review-tools">
      <div
        className="review-tabs"
        role="tablist"
        aria-label="Review tools"
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const index = panes.findIndex((p) => p.id === active);
          const next =
            event.key === "ArrowRight"
              ? (index + 1) % panes.length
              : event.key === "ArrowLeft"
                ? (index + panes.length - 1) % panes.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? panes.length - 1
                    : undefined;
          if (next === undefined) return;
          event.preventDefault();
          const pane = panes[next];
          if (pane) {
            setActive(pane.id);
            buttons.current[next]?.focus();
          }
        }}
      >
        {panes.map((pane, i) => (
          <button
            key={pane.id}
            ref={(node) => {
              buttons.current[i] = node;
            }}
            role="tab"
            id={"review-tab-" + pane.id}
            aria-controls={"review-panel-" + pane.id}
            aria-selected={active === pane.id}
            tabIndex={active === pane.id ? 0 : -1}
            onClick={() => setActive(pane.id)}
          >
            {pane.title}
            {pane.id === "captions" && captionCount > 0 && (
              <span aria-hidden="true">{captionCount}</span>
            )}
          </button>
        ))}
      </div>
      {/* Keep panels mounted so incomplete caption text, ranges and notes survive switching. */}
      {panes.map((pane) => (
        <div
          key={pane.id}
          role="tabpanel"
          id={"review-panel-" + pane.id}
          aria-labelledby={"review-tab-" + pane.id}
          hidden={active !== pane.id}
          className="review-tool-panel"
          tabIndex={0}
        >
          {pane.id === "response"
            ? response
            : pane.id === "captions"
              ? captions
              : evidence}
        </div>
      ))}
    </div>
  );
}
