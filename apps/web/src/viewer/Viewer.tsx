import { useState, useEffect, useRef } from "react";
import { time } from "../client.ts";
import { Logo } from "../components/Logo.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { usePublicReplay } from "./usePublicReplay.ts";
import { captionParts, replayLink, replayPosition } from "./playback.ts";
export function Viewer({ id }: { id: string }) {
  const player = useRef<HTMLVideoElement>(null);
  const captionsTrack = useRef<HTMLTrackElement>(null);
  const [position, setPosition] = useState(0);
  const { reply, error, refresh } = usePublicReplay(id);
  const [copied, setCopied] = useState("");
  const [copyFallback, setCopyFallback] = useState("");
  const [query, setQuery] = useState("");
  const [media, setMedia] = useState<"loading" | "ready" | "failed">("loading");
  const [stalled, setStalled] = useState(false);
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [captionError, setCaptionError] = useState(false);
  const [captionAttempt, setCaptionAttempt] = useState(0);
  const [captionPending, setCaptionPending] = useState(false);
  useEffect(() => {
    setStalled(false);
    if (media !== "loading") return;
    const timer = window.setTimeout(() => setStalled(true), 8000);
    return () => window.clearTimeout(timer);
  }, [media, reloadAttempt]);
  const pendingSeek = useRef<number | undefined>(undefined);
  const hasReply = !!reply;
  useEffect(() => {
    const track = captionsTrack.current;
    if (!track) return;
    const failed = () => {
      window.clearTimeout(timeout);
      setCaptionError(true);
      setCaptionPending(false);
    };
    const loaded = () => {
      window.clearTimeout(timeout);
      setCaptionError(false);
      setCaptionPending(false);
    };
    const timeout = captionPending
      ? window.setTimeout(failed, 8000)
      : undefined;
    track.addEventListener("error", failed);
    track.addEventListener("load", loaded);
    if (track.readyState === 3) failed();
    if (track.readyState === 2) loaded();
    return () => {
      track.removeEventListener("error", failed);
      track.removeEventListener("load", loaded);
      window.clearTimeout(timeout);
    };
  }, [id, hasReply, captionAttempt]);
  useEffect(() => {
    const video = player.current;
    return () => {
      // Discard this managed player's buffered media when access is withdrawn.
      video?.pause();
      video?.removeAttribute("src");
      video?.load();
    };
  }, [id, hasReply]);
  const seek = (seconds: number) => {
    if (!reply) return;
    const next = replayPosition(seconds, reply.duration);
    pendingSeek.current = next;
    if (player.current && player.current.readyState >= 1)
      player.current.currentTime = next;
    setPosition(next);
  };
  const copy = async (moment: boolean) => {
    const url = replayLink(
      location.origin,
      id,
      moment && reply ? replayPosition(position, reply.duration) : 0,
    );
    try {
      await navigator.clipboard.writeText(url);
      setCopyFallback("");
      setCopied(moment ? `Link to ${time(position)} copied.` : "Link copied.");
    } catch {
      setCopyFallback(url);
      setCopied("Select and copy this link.");
    }
  };
  const captions =
    reply?.captions.filter((c) =>
      c.text.toLowerCase().includes(query.trim().toLowerCase()),
    ) ?? [];
  async function retryMedia() {
    const available = await refresh();
    if (available === false) return;
    const video = player.current;
    if (!video || !reply) return;
    if (video.readyState >= 1 || position > 0)
      pendingSeek.current = replayPosition(position, reply.duration);
    video.pause();
    setStalled(false);
    setReloadAttempt((value) => value + 1);
    setMedia("loading");
    video.load();
  }
  return (
    <div className="viewer" role="main">
      <div className="viewer-topbar">
        <Logo studio={false} />
        <ThemeToggle />
      </div>
      {error && !reply ? (
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
            <button onClick={() => void refresh()}>Try again</button>
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
            key={id}
            ref={player}
            onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              const next = replayPosition(
                pendingSeek.current ??
                  new URLSearchParams(location.search).get("t"),
                Math.min(reply.duration, e.currentTarget.duration),
              );
              e.currentTarget.currentTime = next;
              setPosition(next);
              setMedia("ready");
            }}
            onLoadedData={() => setMedia("ready")}
            onCanPlay={() => setMedia("ready")}
            onPlaying={() => setMedia("ready")}
            onWaiting={() => setMedia("loading")}
            onStalled={() => {
              if (player.current && player.current.readyState < 3)
                setMedia("loading");
            }}
            onError={(event) => {
              if (event.target !== event.currentTarget) return;
              player.current?.pause();
              setMedia("failed");
              void refresh();
            }}
            controls
            playsInline
            preload="metadata"
            src={"/api/public/replies/" + id + "/video"}
          >
            <track
              key={captionAttempt}
              ref={captionsTrack}
              kind="captions"
              src={"/api/public/replies/" + id + "/captions"}
              srcLang="en"
              label="English"
              default
            />
          </video>
          <div className="playback-state" aria-live="polite">
            {media === "loading" && <p>Loading replay media…</p>}
            {(media === "failed" || stalled) && (
              <div>
                <p>
                  {stalled
                    ? "Playback is taking longer than expected. Check your connection or retry loading the media."
                    : "Playback couldn’t continue. Check your connection and retry. If it keeps failing, try a browser that supports WebM video (VP9/Opus)."}
                </p>
                <button onClick={() => void retryMedia()}>
                  Retry playback
                </button>
              </div>
            )}
          </div>
          {(captionError || captionPending) && reply.captions.length > 0 && (
            <div className="availability-warning" role="status">
              <p>
                {captionPending
                  ? "Reloading video captions…"
                  : "Video captions could not be loaded. Read the approved transcript below or reload captions."}
              </p>
              <button
                disabled={captionPending}
                onClick={() => {
                  setCaptionError(false);
                  setCaptionPending(true);
                  setCaptionAttempt((value) => value + 1);
                }}
              >
                Reload video captions
              </button>
            </div>
          )}
          {error === "failed" && (
            <div className="availability-warning" role="status">
              <p>
                Couldn’t check this replay’s availability. Check your
                connection.
              </p>
              <button onClick={() => void refresh()}>Check availability</button>
            </div>
          )}
          {reply.captions.length > 0 && (
            <details className="approved-transcript">
              <summary>Read the approved transcript</summary>
              <label className="transcript-search">
                Find in this transcript
                <input
                  type="search"
                  maxLength={200}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search the approved words…"
                />
              </label>
              <p className="transcript-count" role="status">
                {query.trim()
                  ? `${captions.length} matching ${captions.length === 1 ? "caption" : "captions"}.`
                  : "Select a caption to seek. Playback stays under your control."}
              </p>
              <ol>
                {captions.map((c, i) => (
                  <li key={i}>
                    <button
                      className={
                        position >= c.start && position < c.end ? "active" : ""
                      }
                      aria-current={
                        position >= c.start && position < c.end
                          ? "true"
                          : undefined
                      }
                      onClick={() => seek(c.start)}
                    >
                      <span className="caption-time">{time(c.start)}</span>{" "}
                      <span>
                        {captionParts(c.text, query).map((part, n) =>
                          part.match ? (
                            <mark key={n}>{part.text}</mark>
                          ) : (
                            part.text
                          ),
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {captions.length === 0 && (
                <p>No approved captions match. Try another word.</p>
              )}
            </details>
          )}
          <div className="viewer-meta">
            <span>
              ↳ {reply.creator} replied · {time(reply.duration)} ·{" "}
              {new Date(reply.date).toLocaleDateString()}
            </span>
            <a href={"https://twitch.tv/" + encodeURIComponent(reply.creator)}>
              Visit channel ↗
            </a>
          </div>
          <div className="replay-actions">
            <button onClick={() => void copy(false)}>Copy replay link ↗</button>
            <button onClick={() => void copy(true)}>
              Copy link to {time(position)}
            </button>
          </div>
          <p role="status">{copied}</p>
          {copyFallback && (
            <label className="transcript-search">
              Replay link
              <input
                readOnly
                value={copyFallback}
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
          )}
        </article>
      ) : (
        <p role="status">Loading your replay…</p>
      )}
      <footer role="presentation">Every reply has a replay.</footer>
    </div>
  );
}
