import { beginCapture, type BrowserCapture } from "./capture-client.ts";
import { CaptureEpoch } from "../../../../shared/contracts/capture.ts";
import { TranscriptReview } from "./TranscriptReview.tsx";
import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import {
  Asset,
  Message,
  Revision,
  Publication,
  Caption,
} from "../../../../shared/contracts/models.ts";
import { api, time, token, setToken } from "../client.ts";
import { Logo } from "../components/Logo.tsx";
const State = z.object({
  assets: z.array(Asset),
  messages: z.array(Message),
  drafts: z.array(Revision),
  publications: z.array(Publication),
  twitch: z.string(),
  creator: z.string(),
  captures: z.array(CaptureEpoch),
});
type State = z.infer<typeof State>;
export function Studio() {
  const [data, setData] = useState<State>();
  const [tab, setTab] = useState("review");
  const [selected, setSelected] = useState<string>();
  const [edit, setEdit] = useState<Revision>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState(false);
  const recorder = useRef<BrowserCapture | null>(null);
  const [savingCapture, setSavingCapture] = useState(false);
  const player = useRef<HTMLVideoElement | null>(null);
  const dirty = useRef(false);
  const [captionText, setCaptionText] = useState("");
  const [captionValid, setCaptionValid] = useState(true);
  async function load() {
    const v = State.parse(await api("creator/state"));
    setData(v);
  }
  useEffect(() => {
    void api("creator/session")
      .then((v) => {
        setToken(z.object({ token: z.string() }).parse(v).token);
        return load();
      })
      .catch((e) => setNotice(String(e)));
    const timer = setInterval(() => {
      if (token) void load().catch(() => {});
    }, 2500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!dirty.current) {
      const r = data?.drafts.find((r) => r.draftId === selected);
      setEdit(r);
      setCaptionText(
        r?.captions
          .map((c) => `${c.start} | ${c.end} | ${c.text}`)
          .join("\n") ?? "",
      );
      setCaptionValid(true);
    }
  }, [selected, data]);
  async function action(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await fn();
      if (success) setNotice(success);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!setup) return;
    const previous = document.activeElement;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSetup(false);
      if (e.key === "Tab") {
        const dialog = document.querySelector(".modal");
        const all = dialog?.querySelectorAll<HTMLElement>(
          "button,input,textarea,select,a[href]",
        );
        const first = all?.[0];
        const last = all?.[all.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [setup]);
  async function upload(blob: Blob) {
    const res = await fetch("/api/creator/media", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-creator-token": token,
      },
      body: blob,
    });
    const v: unknown = await res.json();
    if (!res.ok)
      throw new Error(
        "Recording could not be saved. Use a valid video under 250 MB / one hour.",
      );
    const a = Asset.parse(v);
    await load();
    setNotice(
      a.audio
        ? "Recording saved. Replay it to verify audio and synchronization."
        : "Recording saved without audio. Choose a source that shares audio, or import an OBS recording.",
    );
  }
  async function capture() {
    try {
      const session = await beginCapture(setNotice);
      recorder.current = session;
      setRecording(true);
      setSetup(false);
      setNotice(
        "Recording selected screen and shared audio. Chunks are saved as they arrive. Verify audio in replay.",
      );
      void session.untilStopped().then(async () => {
        setRecording(false);
        await action(
          () => session.save(true),
          "Recording finalized. Preview sound and synchronization.",
        );
        if (recorder.current === session) recorder.current = null;
      });
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : "Permission denied. Retry sharing or import a recording.",
      );
    }
  }
  async function saveExchange() {
    const session = recorder.current;
    if (!session || savingCapture) return;
    setSavingCapture(true);
    try {
      const a = await session.save(false);
      await load();
      const m = data?.messages.find((m) => !m.removed);
      if (!m) {
        setSetup(true);
        setNotice(
          "Recording snapshot saved. Add or receive a message to connect it.",
        );
        return;
      }
      const id = crypto.randomUUID();
      const r = Revision.parse(
        await api("creator/drafts/" + id, "PUT", {
          expectedVersion: 0,
          messageId: m.id,
          assetId: a.id,
          start: Math.max(0, a.duration - 30),
          end: a.duration,
          title: "A reply worth keeping",
          captions: [],
        }),
      );
      dirty.current = false;
      setSelected(id);
      setEdit(r);
      setTab("review");
      setNotice(
        "Private exchange saved with its full recording. Correct the message and interval before approval.",
      );
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Recording save failed.");
    } finally {
      setSavingCapture(false);
    }
  }
  function change(values: Partial<Revision>, formatCaptions = true) {
    if (values.captions && formatCaptions) {
      setCaptionText(
        values.captions
          .map((c) => `${c.start} | ${c.end} | ${c.text}`)
          .join("\n"),
      );
      setCaptionValid(true);
    }
    if (edit) {
      dirty.current = true;
      setEdit({ ...edit, ...values });
    }
  }
  async function save() {
    if (!edit) return;
    if (!captionValid)
      throw new Error(
        "Finish each caption line as start | end | text before saving.",
      );
    const v = Revision.parse(
      await api("creator/drafts/" + edit.draftId, "PUT", {
        ...edit,
        expectedVersion: edit.version,
      }),
    );
    dirty.current = false;
    setEdit(v);
  }
  async function newDraft() {
    const m = data?.messages.find((m) => !m.removed);
    const a = data?.assets.at(-1);
    if (!m || !a) {
      setSetup(true);
      throw new Error("Add a message and recording to create an exchange.");
    }
    const id = crypto.randomUUID();
    const r = Revision.parse(
      await api("creator/drafts/" + id, "PUT", {
        expectedVersion: 0,
        messageId: m.id,
        assetId: a.id,
        start: 0,
        end: Math.min(a.duration, 30),
        title: "A reply worth keeping",
        captions: [],
      }),
    );
    dirty.current = false;
    setSelected(id);
    setEdit(r);
    setTab("review");
  }
  const drafts =
    data?.drafts.filter((r) => {
      const m = data.messages.find((m) => m.id === r.messageId);
      return (r.title + " " + m?.author + " " + m?.text)
        .toLowerCase()
        .includes(query.toLowerCase());
    }) ?? [];
  const message = data?.messages.find((m) => m.id === edit?.messageId);
  const asset = data?.assets.find((a) => a.id === edit?.assetId);
  const published =
    data?.publications.filter((p) => p.state === "published") ?? [];
  return (
    <div className="shell">
      <aside>
        <Logo />
        <div className="workspace">
          <span className="avatar creator">a</span>
          <div>
            <b>{data?.creator ?? "Your studio"}</b>
            <small>Creator workspace</small>
          </div>
          <span>⌄</span>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Workspace">
          <button
            className={tab === "review" ? "active" : ""}
            onClick={() => {
              setTab("review");
              setSelected(undefined);
              dirty.current = false;
            }}
          >
            <i aria-hidden="true">▧</i> <span>Review exchanges</span>
            <em aria-hidden="true">{data?.drafts.length ?? 0}</em>
          </button>
          <button
            className={tab === "library" ? "active" : ""}
            onClick={() => {
              setTab("library");
              setSelected(undefined);
            }}
          >
            <i aria-hidden="true">↗</i> <span>Published replies</span>
            <em aria-hidden="true">{published.length}</em>
          </button>
          <button onClick={() => setSetup(true)}>
            <i aria-hidden="true">◉</i> <span>Sources & setup</span>
          </button>
        </nav>
        <div className="aside-bottom">
          <div className="quiet-icon">↳</div>
          <h3>
            A moment.
            <br />A connection.
            <br />A little more lasting.
          </h3>
          <p>Your chat is full of conversations worth keeping.</p>
          <div className="local">
            <i /> Local creator studio
          </div>
        </div>
      </aside>
      <main>
        <header>
          <span>YOUR CONVERSATIONS, CONNECTED</span>
          <button className="subtle" onClick={() => setSetup(true)}>
            ⚙ Setup <span className="avatar small">a</span>
          </button>
        </header>
        <div className="content">
          <div className="heading">
            <div>
              <p className="eyebrow">EVERY REPLY HAS A REPLAY</p>
              <h1>
                {edit ? (
                  "Make the connection."
                ) : tab === "library" ? (
                  "Kept for the replay."
                ) : (
                  <>
                    Good conversations
                    <br />
                    deserve to stay.
                  </>
                )}
              </h1>
              <p className="intro">
                {edit
                  ? "A real message. Your actual response. One exchange worth keeping."
                  : tab === "library"
                    ? "The exchanges you approved, ready to revisit."
                    : "Turn a fleeting chat moment into something they can replay."}
              </p>
            </div>
            <button
              className={recording ? "primary recording" : "primary"}
              onClick={() => {
                if (recording) recorder.current?.stop();
                else setSetup(true);
              }}
            >
              {recording ? "■ Stop & save recording" : "◉ Capture an exchange"}{" "}
              <span>↗</span>
            </button>
          </div>
          <div className="status-strip">
            <span>
              <i className={recording ? "dot red" : "dot"} />
              {recording
                ? "Recording selected source"
                : "Capture ready for setup"}
            </span>
            <span>↯ Twitch: {data?.twitch ?? "Checking…"}</span>
            <span>▣ {data?.assets.length ?? 0} recordings saved</span>
            <button onClick={() => setSetup(true)}>Manage sources ↗</button>
          </div>
          {recording && (
            <button
              className="secondary wide"
              disabled={savingCapture}
              onClick={() => void saveExchange()}
            >
              {savingCapture
                ? "Protecting the exchange…"
                : "↳ Save that exchange"}
            </button>
          )}
          <div
            role="status"
            aria-live="polite"
            className={notice ? "notice" : "sr-only"}
          >
            {notice}
          </div>
          {edit ? (
            <section className="editor">
              <button
                className="back"
                onClick={() => {
                  setSelected(undefined);
                  setEdit(undefined);
                  dirty.current = false;
                }}
              >
                ← All exchanges
              </button>
              <div className="edit-grid">
                <div>
                  <div className="video-box">
                    <video
                      ref={player}
                      key={edit.assetId}
                      controls
                      playsInline
                      preload="metadata"
                      onError={() =>
                        setNotice(
                          "This source recording is unavailable or unsupported. Restore it from backup or choose another recording.",
                        )
                      }
                      src={"/api/creator/media/" + edit.assetId}
                      onTimeUpdate={(e) => {
                        if (e.currentTarget.currentTime >= edit.end)
                          e.currentTarget.pause();
                      }}
                    />
                  </div>
                  <div className="trim">
                    <div>
                      <b>Response interval</b>
                      <button
                        onClick={() => {
                          if (player.current) {
                            player.current.currentTime = edit.start;
                            void player.current.play();
                          }
                        }}
                      >
                        ▶ Preview selection
                      </button>
                      <button
                        onClick={() => {
                          if (player.current) {
                            player.current.currentTime = Math.max(
                              0,
                              edit.start - 5,
                            );
                            void player.current.play();
                          }
                        }}
                      >
                        ↶ Lead-in
                      </button>
                    </div>
                    <div className="trim-fields">
                      <label>
                        Start (seconds)
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={edit.start}
                          onChange={(e) =>
                            change({ start: Number(e.target.value) })
                          }
                        />
                      </label>
                      <span>→</span>
                      <label>
                        End (seconds)
                        <input
                          type="number"
                          min="0"
                          max={asset?.duration}
                          step="0.1"
                          value={edit.end}
                          onChange={(e) =>
                            change({ end: Number(e.target.value) })
                          }
                        />
                      </label>
                      <strong>{time(edit.end - edit.start)}</strong>
                    </div>
                    <p>
                      Only this interval becomes public. Preview the opening and
                      closing words.
                    </p>
                  </div>
                  <TranscriptReview
                    revision={edit}
                    dirty={dirty.current}
                    onSelect={(start, end, text, messageId) => {
                      change({
                        start,
                        end,
                        captions: [{ start: 0, end: end - start, text }],
                        ...(messageId ? { messageId } : {}),
                      });
                      if (player.current) {
                        player.current.currentTime = start;
                        void player.current.play();
                      }
                    }}
                  />
                  <label className="field">
                    Captions (relative start | end | text, one per line)
                    <textarea
                      placeholder="0 | 2.5 | Your corrected caption"
                      value={captionText}
                      aria-invalid={!captionValid}
                      onChange={(e) => {
                        const text = e.target.value;
                        setCaptionText(text);
                        dirty.current = true;
                        const parsed = z.array(Caption).safeParse(
                          text
                            .split("\n")
                            .filter((line) => line.trim())
                            .map((line) => {
                              const [start, end, ...words] = line.split("|");
                              return {
                                start: Number(start),
                                end: end === undefined ? NaN : Number(end),
                                text: words.join("|").trim(),
                              };
                            }),
                        );
                        setCaptionValid(parsed.success);
                        if (parsed.success)
                          change({ captions: parsed.data }, false);
                      }}
                    />
                  </label>
                </div>
                <div className="review-panel">
                  <p className="eyebrow">THE ORIGINAL MESSAGE</p>
                  <blockquote>
                    <span className="avatar">
                      {message?.author.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <b>@{message?.author}</b>
                      <p>{message?.text}</p>
                    </div>
                  </blockquote>
                  <label className="field">
                    Connect a different message
                    <select
                      value={edit.messageId}
                      onChange={(e) => change({ messageId: e.target.value })}
                    >
                      {data?.messages
                        .filter((m) => !m.removed)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            @{m.author}: {m.text}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="field">
                    Recording
                    <select
                      value={edit.assetId}
                      onChange={(e) => {
                        const a = data?.assets.find(
                          (a) => a.id === e.target.value,
                        );
                        if (a)
                          change({
                            assetId: a.id,
                            start: 0,
                            end: Math.min(a.duration, 30),
                            captions: [],
                          });
                      }}
                    >
                      {data?.assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.fixture ? "Generated sample" : "Recording"} ·{" "}
                          {time(a.duration)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Replay title
                    <input
                      value={edit.title}
                      maxLength={120}
                      onChange={(e) => change({ title: e.target.value })}
                    />
                  </label>
                  <p className="sample">
                    {asset?.fixture
                      ? "Labelled sample: generated test pattern and tone. No actual spoken answer."
                      : "Private draft • original recording protected"}
                  </p>
                  <button
                    disabled={busy}
                    className="wide secondary"
                    onClick={() =>
                      void action(save, "New revision saved durably.")
                    }
                  >
                    Save private draft
                  </button>
                  <button
                    disabled={busy}
                    className="wide primary"
                    onClick={() =>
                      void action(async () => {
                        if (dirty.current)
                          throw new Error(
                            "Save and preview this revision before approving.",
                          );
                        await api(
                          "creator/drafts/" + edit.draftId + "/approve",
                          "POST",
                          { version: edit.version },
                        );
                      }, "Exact revision approved. Rendering a separate replay file.")
                    }
                  >
                    Approve revision {edit.version} & publish locally ↗
                  </button>
                  <button
                    className="wide danger"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api("creator/drafts/" + edit.draftId, "DELETE");
                        setSelected(undefined);
                        setEdit(undefined);
                        dirty.current = false;
                      }, "Draft discarded. Published revisions remain unchanged.")
                    }
                  >
                    Discard private draft
                  </button>
                  <p className="fine">
                    Approves this message, interval, and captions. Twitch
                    sharing is a separate action.
                  </p>
                </div>
              </div>
            </section>
          ) : (
            <>
              <div className="section-heading">
                <div>
                  <h2>
                    {tab === "review"
                      ? "Your review queue"
                      : "Published exchanges"}{" "}
                    <span>
                      {tab === "review" ? drafts.length : published.length}
                    </span>
                  </h2>
                  <p>
                    {tab === "review"
                      ? "Saved privately. Share only when it feels right."
                      : "Every replay contains only its approved interval."}
                  </p>
                </div>
                <div className="tools">
                  <input
                    aria-label="Search exchanges"
                    placeholder="⌕  Find a conversation"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void action(newDraft, "New private draft created.")
                    }
                  >
                    + New exchange
                  </button>
                </div>
              </div>
              {tab === "review" ? (
                <div className="cards">
                  {drafts.map((r, i) => {
                    const m = data?.messages.find((m) => m.id === r.messageId);
                    const a = data?.assets.find((a) => a.id === r.assetId);
                    const p = data?.publications.find(
                      (p) => p.revisionId === r.id,
                    );
                    return (
                      <article className="card" key={r.id}>
                        <div className={"card-media tone-" + (i % 3)}>
                          <video
                            preload="metadata"
                            muted
                            src={
                              "/api/creator/media/" +
                              r.assetId +
                              "#t=" +
                              r.start
                            }
                          />
                          <span className="media-label">
                            {a?.fixture
                              ? "GENERATED SAMPLE"
                              : "SOURCE RECORDING"}
                          </span>
                          <button
                            aria-label={"Review " + r.title}
                            className="play"
                            onClick={() => {
                              dirty.current = false;
                              setSelected(r.draftId);
                            }}
                          >
                            ▶
                          </button>
                          <span className="duration">
                            {time(r.end - r.start)}
                          </span>
                        </div>
                        <div className="card-body">
                          <div className="message-line">
                            <span className="avatar">
                              {m?.author.slice(0, 1).toUpperCase()}
                            </span>
                            <div>
                              <b>@{m?.author}</b>
                              <p>{m?.text}</p>
                            </div>
                          </div>
                          <div className="connection">
                            <span>↳</span>
                            <h3>{r.title}</h3>
                          </div>
                          <div className="card-footer">
                            <span className="badge">
                              {p?.state ?? "Private draft"}
                            </span>
                            <button
                              onClick={() => {
                                dirty.current = false;
                                setSelected(r.draftId);
                              }}
                            >
                              Review exchange ↗
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="cards">
                  {published
                    .filter((p) => {
                      const r = data?.drafts.find((r) => r.id === p.revisionId);
                      return (
                        !query ||
                        r?.title.toLowerCase().includes(query.toLowerCase())
                      );
                    })
                    .map((p) => (
                      <article className="card publication" key={p.id}>
                        <p className="eyebrow">APPROVED REPLAY</p>
                        <h3>
                          {data?.drafts.find((r) => r.id === p.revisionId)
                            ?.title ?? "Published revision"}
                        </h3>
                        <a
                          className="button primary"
                          href={"/r/" + p.id}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open replay ↗
                        </a>
                        <button
                          onClick={() =>
                            void action(async () => {
                              const result = z
                                .object({ state: z.string() })
                                .parse(
                                  await api(
                                    "creator/publications/" + p.id + "/share",
                                    "POST",
                                  ),
                                );
                              setNotice("Twitch delivery: " + result.state);
                            }, "")
                          }
                        >
                          Share in Twitch
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void action(
                              () =>
                                api(
                                  "creator/publications/" + p.id + "/portrait",
                                  "POST",
                                ),
                              "Portrait export ready.",
                            )
                          }
                        >
                          Create portrait export
                        </button>
                        {p.portrait && (
                          <a
                            href={"/api/public/replies/" + p.id + "/portrait"}
                            download
                          >
                            Download portrait ↧
                          </a>
                        )}
                        <button
                          className="danger"
                          onClick={() =>
                            void action(
                              () =>
                                api("creator/publications/" + p.id, "DELETE"),
                              "Replay removed. Managed access disabled.",
                            )
                          }
                        >
                          Unpublish
                        </button>
                      </article>
                    ))}
                </div>
              )}
              {(tab === "review" ? drafts.length : published.length) === 0 && (
                <div className="empty">
                  <span>↳</span>
                  <h2>
                    {tab === "review"
                      ? "Your next good conversation starts here."
                      : "Nothing public until you say so."}
                  </h2>
                  <p>
                    Import a recording, add a source message, and connect the
                    two.
                  </p>
                  <button className="primary" onClick={() => setSetup(true)}>
                    Set up your sources ↗
                  </button>
                </div>
              )}
              <div className="note">
                <span>✧</span>
                <p>
                  <b>You keep the final say.</b> Every exchange stays private
                  until you preview and approve a specific version.
                </p>
                <span>MADE FOR THE MOMENTS BETWEEN</span>
              </div>
            </>
          )}
          <footer>
            <span>replylink / creator studio</span>
            <span>Keep the message. Replay the reply. ↳</span>
          </footer>
        </div>
      </main>
      {setup && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="setup-title"
          >
            <button
              className="close"
              autoFocus
              onClick={() => setSetup(false)}
              aria-label="Close setup"
            >
              ×
            </button>
            <p className="eyebrow">LET’S MAKE A CONNECTION</p>
            <h2 id="setup-title">Your sources, your choice.</h2>
            {data?.captures
              .filter(
                (c) =>
                  c.state === "interrupted" ||
                  (c.state === "recording" &&
                    c.id !== recorder.current?.epoch.id),
              )
              .map((c) => (
                <section className="capture-recovery" key={c.id}>
                  <h3>Interrupted recording</h3>
                  <p>
                    {c.reason ??
                      "This recording is no longer connected to this tab."}{" "}
                    {c.nextSequence} chunks acknowledged. Unacknowledged footage
                    cannot be recovered.
                  </p>
                  <button
                    disabled={busy || c.nextSequence === 0}
                    className="secondary"
                    onClick={() =>
                      void action(
                        () =>
                          api(
                            "creator/captures/" + c.id + "/snapshot",
                            "POST",
                            { finish: true },
                          ),
                        "Acknowledged footage recovered. Verify its beginning and ending before review.",
                      )
                    }
                  >
                    Recover recording
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api(
                          "creator/captures/" + c.id + "/interrupt",
                          "POST",
                        );
                        await api("creator/captures/" + c.id, "DELETE");
                      }, "Unfinished recording discarded. Saved drafts and snapshots remain protected.")
                    }
                  >
                    Discard unfinished recording
                  </button>
                </section>
              ))}
            <p>
              Capture a selected screen and its shared audio, or import a
              finalized OBS recording. No microphone is added. Verify sound and
              sync in playback.
            </p>
            <div className="setup-choice">
              <h3>01 / Bring the recording</h3>
              <button className="primary" onClick={() => void capture()}>
                Choose screen or tab ↗
              </button>
              <label className="file-label">
                Import a recording
                <input
                  type="file"
                  accept="video/*,.mkv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      void action(
                        () => upload(f),
                        "Recording saved. Verify sound and sync in review.",
                      );
                  }}
                />
              </label>
              <p className="fine">
                Screen capture: chunks saved during recording; up to 1 hour /
                220 MB per recording. File import: up to 250 MB / 1 hour.
                Interrupted captures can recover acknowledged footage. No
                microphone is added.
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action(
                  () =>
                    api("creator/messages", "POST", {
                      author: f.get("author"),
                      text: f.get("text"),
                    }),
                  "Manually entered source message saved.",
                );
              }}
            >
              <h3>02 / Connect a message</h3>
              <p className="fine">
                Twitch: set your public app ID in .env and run npm run
                twitch:login. Manual messages are labelled as manually entered.
              </p>
              <label className="field">
                Viewer name
                <input
                  name="author"
                  required
                  maxLength={80}
                  placeholder="mira"
                />
              </label>
              <label className="field">
                Original message
                <textarea
                  name="text"
                  required
                  maxLength={2000}
                  placeholder="The message you’re replying to…"
                />
              </label>
              <button className="secondary" disabled={busy}>
                Add manual message
              </button>
            </form>
            <button
              className="wide primary"
              onClick={() => {
                setSetup(false);
                void action(
                  newDraft,
                  "Private exchange created. Preview the source and adjust the interval.",
                );
              }}
            >
              03 / Create an exchange →
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
