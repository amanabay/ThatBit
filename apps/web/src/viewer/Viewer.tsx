import { useState, useEffect } from "react";
import { PublicReply } from "../../../../shared/contracts/models.ts";
import { api, time } from "../client.ts";
import { Logo } from "../components/Logo.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
export function Viewer({ id }: { id: string }) {
  const [reply, setReply] = useState<PublicReply>();
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  useEffect(() => {
    api("public/replies/" + id)
      .then((v) => setReply(PublicReply.parse(v)))
      .catch((e) => setError(String(e)));
  }, [id]);
  return (
    <div className="viewer" role="main">
      <div className="viewer-topbar">
        <Logo />
        <ThemeToggle />
      </div>
      {error ? (
        <div className="empty">
          <h1>This replay is unavailable.</h1>
          <p>
            The creator may have removed it. Downloaded copies cannot be
            recalled.
          </p>
        </div>
      ) : reply ? (
        <article>
          <p className="eyebrow">A CONVERSATION WORTH KEEPING</p>
          <h1>{reply.title}</h1>
          {reply.fixture && (
            <p className="sample">
              Generated fixture • sample message • no spoken response
            </p>
          )}
          <blockquote>
            <span className="avatar">
              {reply.author.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <b>@{reply.author}</b>
              <p>{reply.message}</p>
            </div>
          </blockquote>
          <div className="thread-line" />
          <video
            controls
            playsInline
            preload="metadata"
            src={"/api/public/replies/" + id + "/video"}
          >
            <track
              kind="captions"
              src={"/api/public/replies/" + id + "/captions"}
              srcLang="en"
              label="English"
              default
            />
          </video>
          <div className="viewer-meta">
            <span>
              ↳ {reply.creator} replied · {time(reply.duration)} ·{" "}
              {new Date(reply.date).toLocaleDateString()}
            </span>
            <a href={"https://twitch.tv/" + encodeURIComponent(reply.creator)}>
              Visit channel ↗
            </a>
          </div>
          <button
            onClick={() => {
              void navigator.clipboard
                .writeText(location.href)
                .then(() => setCopied("Link copied."))
                .catch(() => setCopied("Copy the URL from your address bar."));
            }}
          >
            Copy replay link ↗
          </button>
          <p role="status">{copied}</p>
        </article>
      ) : (
        <p role="status">Loading your replay…</p>
      )}
      <footer role="presentation">Every reply has a replay.</footer>
    </div>
  );
}
