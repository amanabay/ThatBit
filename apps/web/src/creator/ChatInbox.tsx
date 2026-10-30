import { useState } from "react";
import type { Asset, Message } from "../../../../shared/contracts/models.ts";
import { time } from "../client.ts";

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
  const [limit, setLimit] = useState(50);
  const asset = assets.find((a) => a.id === assetId);
  const filtered = messages
    .filter(
      (m) =>
        (removed || !m.removed) &&
        (source === "all" || m.source === source) &&
        `${m.author} ${m.text}`.toLowerCase().includes(query.toLowerCase()),
    )
    .toReversed();
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
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(50);
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
              setLimit(50);
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
          {filtered.length} matching message{filtered.length === 1 ? "" : "s"}
        </span>
        <label>
          <input
            type="checkbox"
            checked={removed}
            onChange={(e) => setRemoved(e.target.checked)}
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
      {filtered.length === 0 && (
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
        {filtered.slice(0, limit).map((m) => (
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
              disabled={busy || m.removed || !asset}
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
      {filtered.length > limit && (
        <button className="secondary wide" onClick={() => setLimit(limit + 50)}>
          Show more messages
        </button>
      )}
    </section>
  );
}
