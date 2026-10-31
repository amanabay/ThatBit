import { useEffect, useRef, useState } from "react";
import { InboxPage } from "../../../../shared/contracts/inbox.ts";
import type { Message } from "../../../../shared/contracts/models.ts";
import { api } from "../client.ts";
export function MessageSearch({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (message: Message) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState<number[]>([]);
  const [result, setResult] = useState<{ key: string; page: InboxPage }>();
  const [error, setError] = useState("");
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const before = cursors.at(-1);
  const key = JSON.stringify([query, before]);
  useEffect(() => {
    if (!open || disabled) return;
    const abort = new AbortController();
    setError("");
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ query, limit: "20" });
      if (before !== undefined) params.set("before", String(before));
      void api(
        "creator/inbox?" + params,
        "GET",
        undefined,
        AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
      )
        .then((value) => {
          if (!abort.signal.aborted)
            setResult({ key, page: InboxPage.parse(value) });
        })
        .catch(() => {
          if (!abort.signal.aborted)
            setError(
              "Messages could not be loaded. Close and reopen after reconnecting.",
            );
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [open, disabled, query, before, key]);
  const current = result?.key === key;
  const page = current ? result.page : undefined;
  return (
    <details
      className="message-search"
      ref={details}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary ref={summary}>Find another original message</summary>
      <p className="fine">
        Search all saved messages, including older chat. Choosing one changes
        this private draft; save before approval.
      </p>
      <label className="field">
        Find a viewer or message
        <input
          aria-label="Find a viewer or message"
          value={query}
          maxLength={100}
          disabled={disabled}
          placeholder="Name or original words"
          onChange={(e) => {
            setQuery(e.target.value);
            setCursors([]);
          }}
        />
      </label>
      <p className="fine" aria-live="polite">
        {disabled
          ? "Message selection is temporarily paused."
          : error ||
            (page
              ? `${page.total} available messages match.`
              : "Finding messages…")}
      </p>
      <ul className="message-search-results">
        {page?.items.map((message) => (
          <li key={message.id}>
            <button
              disabled={disabled || Boolean(error)}
              onClick={() => {
                onPick(message);
                if (details.current) details.current.open = false;
                summary.current?.focus();
              }}
            >
              <strong>@{message.author}</strong>
              <span>{message.text}</span>
              <small>
                {message.source === "fixture"
                  ? "Fixture · not live chat"
                  : message.source === "manual"
                    ? "Manually entered"
                    : "Twitch received"}{" "}
                · {new Date(message.receivedAt).toLocaleString()}
              </small>
            </button>
          </li>
        ))}
      </ul>
      {page && page.items.length === 0 && (
        <p className="fine">
          Try the viewer's name or fewer words. Removed messages cannot be
          selected.
        </p>
      )}
      <div className="message-search-paging">
        {cursors.length > 0 && (
          <button
            className="subtle"
            disabled={disabled || !current || Boolean(error)}
            onClick={() => setCursors((v) => v.slice(0, -1))}
          >
            Newer matches
          </button>
        )}
        {page?.nextCursor && (
          <button
            className="subtle"
            disabled={disabled || !current || Boolean(error)}
            onClick={() => {
              const next = page.nextCursor;
              if (next !== null) setCursors((v) => [...v, next]);
            }}
          >
            Older matches
          </button>
        )}
      </div>
    </details>
  );
}
