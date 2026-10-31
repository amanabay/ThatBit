import { useState, useEffect } from "react";
import type { Asset, Message } from "../../../../shared/contracts/models.ts";
import { api, time, token } from "../client.ts";
import { InboxPage } from "../../../../shared/contracts/inbox.ts";

export function ChatInbox({
  messages,
  assets,
  busy,
  onCreate,
  onSetup,
}: {
  messages: Message[];
  assets: Asset[];
  busy: boolean;
  onCreate: (messageId: string, asset: Asset) => void;
  onSetup: () => void;
}) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [removed, setRemoved] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [cursors, setCursors] = useState<number[]>([]);
  const [page, setPage] = useState<InboxPage>({
    items: [],
    total: 0,
    nextCursor: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const asset = assets.find((a) => a.id === assetId);
  const before = cursors.at(-1);
  useEffect(() => {
    if (!token) return;
    const abort = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        query,
        source,
        removed: String(removed),
      });
      if (before !== undefined) params.set("before", String(before));
      void api(
        "creator/inbox?" + params,
        "GET",
        undefined,
        AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
      )
        .then((v) => {
          if (!abort.signal.aborted) {
            setPage(InboxPage.parse(v));
            setError("");
          }
        })
        .catch(() => {
          if (!abort.signal.aborted)
            setError("Messages could not be refreshed. Reconnecting…");
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, source, removed, before, messages]);
  return (
    <section className="chat-inbox" aria-label="Received chat inbox">
      <div className="section-heading">
        <div>
          <h2>Your side of the conversation.</h2>
          <p>Original messages, ready to connect to your actual response.</p>
        </div>
        <button className="secondary" onClick={onSetup}>
          Add a manual message
        </button>
      </div>
      <div className="inbox-controls">
        <label>
          Search messages
          <input
            maxLength={100}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursors([]);
            }}
            placeholder="Viewer or words from their message"
          />
        </label>
        <label>
          Message source
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setCursors([]);
            }}
          >
            <option value="all">All sources</option>
            <option value="twitch">Received from Twitch</option>
            <option value="manual">Manually entered</option>
            <option value="fixture">Labelled fixtures</option>
          </select>
        </label>
        <label>
          Recording for this exchange
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">Choose a saved recording</option>
            {assets.toReversed().map((a) => (
              <option value={a.id} key={a.id}>
                {a.fixture ? "Generated fixture" : "Recording"} ·{" "}
                {time(a.duration)} · {new Date(a.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="inbox-summary">
        <span>
          {page.total} matching message{page.total === 1 ? "" : "s"}
        </span>
        <label>
          <input
            type="checkbox"
            checked={removed}
            onChange={(e) => {
              setRemoved(e.target.checked);
              setCursors([]);
            }}
          />{" "}
          Include removed messages
        </label>
      </div>
      {!asset && (
        <p className="fine">
          Choose a recording before creating an exchange. Preview and correct
          its interval before approval.
        </p>
      )}
      {page.items.length === 0 && !loading && !error && (
        <div className="empty">
          <h3>No messages in this view yet.</h3>
          <p>
            Connect Twitch in Sources & setup, or add a labelled manual message.
            A connected stream is not required to receive chat.
          </p>
          <button onClick={onSetup}>Open Sources & setup</button>
        </div>
      )}
      <div className="inbox-messages">
        {page.items.map((m) => (
          <article
            key={m.id}
            className={"inbox-message" + (m.removed ? " removed-message" : "")}
          >
            <span className="avatar" aria-hidden="true">
              {m.author.slice(0, 1).toUpperCase()}
            </span>
            <div className="inbox-message-body">
              <div className="inbox-message-meta">
                <b>@{m.author}</b>
                <span className="badge">
                  {m.source === "twitch"
                    ? "Twitch received"
                    : m.source === "manual"
                      ? "Manually entered"
                      : "Fixture · not live chat"}
                </span>
                <time dateTime={m.receivedAt}>
                  {m.source === "twitch" ? "Event" : "Saved"}{" "}
                  {new Date(m.receivedAt).toLocaleString()}
                </time>
                {m.arrivedAt && (
                  <time dateTime={m.arrivedAt}>
                    Arrived locally {new Date(m.arrivedAt).toLocaleTimeString()}
                  </time>
                )}
              </div>
              <p>{m.text}</p>
              {m.removed && (
                <p className="sample">
                  Removed message · cannot be approved or used for a new
                  exchange.
                </p>
              )}
            </div>
            <button
              className="secondary"
              disabled={
                busy || loading || Boolean(error) || m.removed || !asset
              }
              aria-label={`Connect response ↗ for ${m.author}: ${m.text}`}
              onClick={() => {
                if (asset) onCreate(m.id, asset);
              }}
            >
              Connect response ↗
            </button>
          </article>
        ))}
      </div>
      <p className="fine" role="status">
        {error ||
          (loading
            ? "Refreshing messages…"
            : before
              ? "Viewing older messages."
              : "Showing newest messages.")}
      </p>
      <div className="inbox-summary">
        {cursors.length > 0 && (
          <button
            className="secondary"
            disabled={loading}
            onClick={() => setCursors((v) => v.slice(0, -1))}
          >
            Newer messages
          </button>
        )}
        {page.nextCursor !== null && (
          <button
            className="secondary"
            disabled={loading}
            onClick={() => {
              const next = page.nextCursor;
              if (next !== null) setCursors((v) => [...v, next]);
            }}
          >
            Older messages
          </button>
        )}
      </div>
    </section>
  );
}
