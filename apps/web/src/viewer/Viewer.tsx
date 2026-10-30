import { useState, useEffect } from "react";
import { PublicReply } from "../../../../shared/contracts/models.ts";
import { api, time, ApiError } from "../client.ts";
import { Logo } from "../components/Logo.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
export function Viewer({ id }: { id: string }) {
  const [reply, setReply] = useState<PublicReply>();
  const [error, setError] = useState<"unavailable" | "failed">();
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState("");
  useEffect(() => {
    let alive = true;
    setReply(undefined);
    setError(undefined);
    api("public/replies/" + id)
      .then((v) => {
        const value = PublicReply.parse(v);
        if (alive) setReply(value);
      })
      .catch((e) => {
        if (alive)
          setError(
            e instanceof ApiError && [404, 410].includes(e.status)
              ? "unavailable"
              : "failed",
          );
      });
    return () => {
      alive = false;
    };
  }, [id, attempt]);
  return (
    <div className="viewer" role="main">
      <div className="viewer-topbar">
        <Logo studio={false} />
        <ThemeToggle />
      </div>
      {error ? (
        <div className="empty">
          <h1>
            {error === "unavailable"
              ? "This replay is unavailable."
              : "Couldn’t load this replay."}
          </h1>
          <p>
            {error === "unavailable"
              ? "The creator may have removed it. Downloaded copies cannot be recalled."
              : "Check your connection and try loading the replay again."}
          </p>
          {error === "failed" && (
            <button onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          )}
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
