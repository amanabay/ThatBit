import { beginCapture, type BrowserCapture } from "./capture-client.ts";
import { TranscriptReview } from "./TranscriptReview.tsx";
import { useState, useEffect, useRef, useCallback } from "react";
import { z } from "zod";
import {
  Asset,
  Revision,
  Publication,
  Message,
} from "../../../../shared/contracts/models.ts";
import {
  api,
  apiUpload,
  time,
  refreshCreatorSession,
  RequestInterrupted,
} from "../client.ts";
import { Logo } from "../components/Logo.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { CaptionEditor } from "./CaptionEditor.tsx";
import { RenderStatus, renderLabel } from "./RenderStatus.tsx";
import {
  captionText as formatCaptionText,
  parseCaptions,
  rebaseCaptionText,
} from "./captions.ts";
import { StudioState as State } from "../../../../shared/contracts/studio.ts";
import { ChatInbox } from "./ChatInbox.tsx";
import { CaptureReadiness } from "./CaptureReadiness.tsx";
import { AssistanceActivity } from "./AssistanceActivity.tsx";
import { ResponseTimeline } from "./ResponseTimeline.tsx";
import { SuggestionEvidence } from "./SuggestionEvidence.tsx";
import { ReviewNotes } from "./ReviewNotes.tsx";
import { ReviewTools } from "./ReviewTools.tsx";
import { MessageSearch } from "./MessageSearch.tsx";
import { MessageResult } from "../../../../shared/contracts/inbox.ts";
import { DraftCaptionTrack } from "./DraftCaptionTrack.tsx";
import { ReaderSyncStatus } from "./ReaderSyncStatus.tsx";
export function Studio() {
  const [data, setData] = useState<State>();
  const [connectionError, setConnectionError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const loading = useRef(false);
  const loadGeneration = useRef(0);
  const [tab, setTab] = useState("review");
  const [selected, setSelected] = useState<string>();
  const [edit, setEdit] = useState<Revision>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const actionRunning = useRef(false);
  const createdMessage = useRef<Message | undefined>(undefined);
  const reviewsPending = useRef(new Set<string>());
  const onReviewPending = useCallback((id: string, pending: boolean) => {
    if (pending) reviewsPending.current.add(id);
    else reviewsPending.current.delete(id);
  }, []);
  const [manualSource, setManualSource] = useState({ author: "", text: "" });
  const captureStarting = useRef(false);
  const [startingCapture, setStartingCapture] = useState(false);
  const capturingSnapshot = useRef(false);
  const [recordingUndo, setRecordingUndo] = useState<{
    revision: Revision;
    captions: string;
  }>();
  const [setup, setSetup] = useState(false);
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState(false);
  const [captureProgress, setCaptureProgress] = useState("");
  const recorder = useRef<BrowserCapture | null>(null);
  const [savingCapture, setSavingCapture] = useState(false);
  const [obsCount, setObsCount] = useState(3);
  const player = useRef<HTMLVideoElement | null>(null);
  const previewLimit = useRef<number | undefined>(undefined);
  const [pickedMessage, setPickedMessage] = useState<Message>();
  const pickedMessageId = useRef<string | undefined>(undefined);
  const approvalControls = useRef<HTMLElement | null>(null);
  const dirty = useRef(false);
  const editGeneration = useRef(0);
  const currentDraft = useRef<string | undefined>(undefined);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveUncertain, setSaveUncertain] = useState(false);
  const [savedComparison, setSavedComparison] = useState<Revision>();
  const [captionText, setCaptionText] = useState("");
  const previousRenders = useRef<Map<string, Publication["state"]> | undefined>(
    undefined,
  );
  const [renderCompleted, setRenderCompleted] = useState<string>();
  const [justApproved, setJustApproved] = useState<string>();
  useEffect(() => {
    previewLimit.current = undefined;
  }, [edit?.draftId, edit?.assetId, edit?.start, edit?.end]);
  useEffect(() => {
    if (!data) return;
    const previous = previousRenders.current;
    if (previous) {
      const completed = data.publications.find(
        (p) => p.state === "published" && previous.get(p.id) !== "published",
      );
      if (completed) {
        setRenderCompleted(completed.id);
        setNotice((current) =>
          [
            "Exact revision approved. Rendering a separate replay file.",
            "Retry queued for the same approved revision.",
          ].includes(current)
            ? "Your approved replay has rendered successfully."
            : current,
        );
      }
    }
    previousRenders.current = new Map(
      data.publications.map((p) => [p.id, p.state]),
    );
  }, [data]);
  useEffect(() => {
    currentDraft.current = edit?.draftId;
    pickedMessageId.current = undefined;
    setPickedMessage(undefined);
  }, [edit?.draftId]);
  useEffect(() => {
    setSaveError("");
    setSaveUncertain(false);
    setSavedComparison(undefined);
  }, [selected]);
  async function load() {
    const generation = ++loadGeneration.current;
    const signal = AbortSignal.timeout(8000);
    try {
      const v = State.parse(
        await api("creator/state", "GET", undefined, signal),
      );
      if (generation !== loadGeneration.current) return;
      const extraId = pickedMessageId.current;
      const needsExtra = Boolean(
        extraId && !v.messages.some((m) => m.id === extraId),
      );
      let extraMessage: Message | null | undefined;
      if (extraId && needsExtra) {
        extraMessage = MessageResult.parse(
          await api("creator/messages/" + extraId, "GET", undefined, signal),
        ).message;
      }
      // A slow poll must never replace the newer state acknowledged by saving.
      if (generation !== loadGeneration.current) return;
      if (extraId && pickedMessageId.current === extraId) {
        if (needsExtra) setPickedMessage(extraMessage ?? undefined);
        else {
          pickedMessageId.current = undefined;
          setPickedMessage(undefined);
        }
      }
      setData(v);
      setConnectionError("");
      setLastUpdated(new Date().toLocaleTimeString());
      return v;
    } catch (error) {
      if (generation === loadGeneration.current) throw error;
    }
  }
  async function reconnect() {
    if (loading.current) return;
    loading.current = true;
    try {
      await refreshCreatorSession();
      await load();
    } catch {
      setConnectionError(
        "Studio connection lost. Saved information may be out of date. Unsaved edits remain in this tab.",
      );
    } finally {
      loading.current = false;
    }
  }
  useEffect(() => {
    void reconnect();
    const timer = setInterval(() => {
      if (!loading.current) {
        loading.current = true;
        void load()
          .catch(() =>
            setConnectionError(
              "Studio connection lost. Saved information may be out of date. Unsaved edits remain in this tab.",
            ),
          )
          .finally(() => {
            loading.current = false;
          });
      }
    }, 2500);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current || reviewsPending.current.size || recorder.current)
        event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);
  function canLeave() {
    if (capturingSnapshot.current) {
      setNotice(
        "Wait for the recording snapshot to finish before changing drafts.",
      );
      return false;
    }
    if (reviewsPending.current.size) {
      setNotice(
        "Save or discard your private review changes before leaving this draft.",
      );
      return false;
    }
    if (dirty.current || savingDraft) {
      setNotice(
        "Save your changes or use Revert unsaved changes before leaving this draft.",
      );
      return false;
    }
    return true;
  }
  function moveExchange(delta: number) {
    if (!canLeave()) return;
    const next = drafts[reviewIndex + delta];
    if (!next) return;
    player.current?.pause();
    setSelected(next.draftId);
    setNotice("");
  }
  function showApproval() {
    approvalControls.current?.focus({ preventScroll: true });
    approvalControls.current?.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  function navigate(next: string) {
    if (!canLeave()) return;
    setTab(next);
    setSelected(undefined);
    setEdit(undefined);
  }
  function revert() {
    const saved = data?.drafts.find((r) => r.draftId === edit?.draftId);
    if (!saved) return;
    dirty.current = false;
    pickedMessageId.current = undefined;
    setPickedMessage(undefined);
    editGeneration.current++;
    setEdit(saved);
    setCaptionText(formatCaptionText(saved.captions));
    setSaveError("");
    setSaveUncertain(false);
    setSavedComparison(undefined);
    setRecordingUndo(undefined);
    setNotice("Unsaved changes reverted to the saved revision.");
  }
  useEffect(() => {
    if (!dirty.current) {
      const r = data?.drafts.find((r) => r.draftId === selected);
      setEdit(r);
      setCaptionText(
        r?.captions
          .map((c) => `${c.start} | ${c.end} | ${c.text}`)
          .join("\n") ?? "",
      );
    }
  }, [selected, data]);
  async function action(fn: () => Promise<unknown>, success: string) {
    if (actionRunning.current) return false;
    actionRunning.current = true;
    setBusy(true);
    try {
      const result = await fn();
      if (result === false) return false;
      if (success) setNotice(success);
      void load().catch(() =>
        setConnectionError(
          "The action completed, but Studio could not refresh its status. Reconnect before repeating it.",
        ),
      );
      return true;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Operation failed.");
      return false;
    } finally {
      actionRunning.current = false;
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
        const candidates = dialog?.querySelectorAll<HTMLElement>(
          "button,input,textarea,select,a[href]",
        );
        const all = candidates
          ? Array.from(candidates).filter(
              (node) =>
                !node.matches(":disabled,[hidden]") &&
                node.getClientRects().length > 0,
            )
          : [];
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
    if (blob.size > 250 * 1024 * 1024)
      throw new Error("Choose a finalized recording of at most 250 MB.");
    const a = Asset.parse(await apiUpload("creator/media", blob));
    loadGeneration.current++;
    setData((current) =>
      current
        ? {
            ...current,
            assets: [...current.assets.filter((v) => v.id !== a.id), a],
          }
        : current,
    );
    setNotice(
      a.audio
        ? "Recording saved. Replay it to verify audio and synchronization."
        : "Recording saved without audio. Choose a source that shares audio, or import an OBS recording.",
    );
  }
  async function capture() {
    if (captureStarting.current || recorder.current) {
      setNotice("Finish the current capture before starting another.");
      return;
    }
    captureStarting.current = true;
    setStartingCapture(true);
    try {
      setCaptureProgress("");
      const session = await beginCapture((text) => {
        if (text.startsWith("Recording ·")) setCaptureProgress(text);
        else setNotice(text);
      });
      recorder.current = session;
      setRecording(true);
      setSetup(false);
      setNotice(
        "Recording selected screen and shared audio. Chunks are saved as they arrive. Verify audio in replay.",
      );
      void session.untilStopped().then(async () => {
        setRecording(false);
        try {
          setCaptureProgress("Finalizing recording…");
          const a = await session.save(true);
          loadGeneration.current++;
          setData((current) =>
            current
              ? {
                  ...current,
                  assets: [...current.assets.filter((v) => v.id !== a.id), a],
                }
              : current,
          );
          setNotice("Recording finalized. Preview sound and synchronization.");
          try {
            await load();
          } catch {
            setConnectionError(
              "Recording finalized; reconnect Studio to refresh status.",
            );
          }
        } catch (error) {
          setNotice(
            error instanceof Error
              ? error.message
              : "Recording finalization failed. Recover acknowledged footage in Sources & setup.",
          );
        } finally {
          if (recorder.current === session) recorder.current = null;
          setCaptureProgress("");
        }
      });
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : "Permission denied. Retry sharing or import a recording.",
      );
    } finally {
      captureStarting.current = false;
      setStartingCapture(false);
    }
  }
  async function saveExchange() {
    if (!canLeave()) return;
    const session = recorder.current;
    if (!session || savingCapture) return;
    capturingSnapshot.current = true;
    setSavingCapture(true);
    try {
      const a = await session.save(false);
      loadGeneration.current++;
      setData((current) =>
        current
          ? {
              ...current,
              assets: [...current.assets.filter((v) => v.id !== a.id), a],
            }
          : current,
      );
      let refreshed: State | undefined;
      try {
        refreshed = await load();
      } catch {
        setConnectionError(
          "Recording snapshot saved. Reconnect Studio before connecting its message.",
        );
        setNotice(
          "Recording snapshot saved. Reconnect Studio, then choose it in Received chat.",
        );
        return;
      }
      const m = (refreshed ?? data)?.messages.findLast((m) => !m.removed);
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
      const focused = openRevision(r, m, a);
      if (focused)
        setNotice(
          "Private exchange saved with its full recording. Correct the message and interval before approval.",
        );
      try {
        await load();
      } catch {
        setConnectionError(
          "Private exchange saved; reconnect Studio to refresh status.",
        );
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Recording save failed.");
    } finally {
      setSavingCapture(false);
      capturingSnapshot.current = false;
    }
  }
  function change(values: Partial<Revision>) {
    if (values.captions) setCaptionText(formatCaptionText(values.captions));
    else if (edit && values.start !== undefined && values.start !== edit.start)
      setCaptionText(rebaseCaptionText(captionText, edit.start - values.start));
    if (edit) {
      dirty.current = true;
      editGeneration.current++;
      setSaveError("");
      setEdit({ ...edit, ...values });
    }
  }
  async function save() {
    if (!edit) return;
    if (reviewsPending.current.size)
      throw new Error(
        "Save or discard your private review changes before saving a new draft revision.",
      );
    setSaveError("");
    setSaveUncertain(false);
    setSavedComparison(undefined);
    const generation = editGeneration.current;
    const submitted = edit;
    setSavingDraft(true);
    try {
      const checked = parseCaptions(captionText, edit.end - edit.start);
      if (!checked.valid) throw new Error(checked.errors[0]);
      if (!dirty.current) {
        setNotice("Private draft saved durably.");
        return;
      }
      const v = Revision.parse(
        await api("creator/drafts/" + edit.draftId, "PUT", {
          ...edit,
          captions: checked.captions,
          expectedVersion: edit.version,
        }),
      );
      if (currentDraft.current !== submitted.draftId) return;
      if (generation === editGeneration.current) {
        dirty.current = false;
        setEdit(v);
        setNotice("Private draft saved durably.");
      } else {
        // Preserve edits made while this revision was being saved. Their next
        // save must compare against the newly acknowledged server version.
        setEdit((current) =>
          current?.draftId === v.draftId
            ? {
                ...current,
                id: v.id,
                version: v.version,
                createdAt: v.createdAt,
              }
            : current,
        );
        setNotice(
          "Previous revision saved. Your newer changes still need saving.",
        );
      }
    } catch (error) {
      setSaveUncertain(error instanceof RequestInterrupted && error.uncertain);
      if (currentDraft.current === submitted.draftId)
        setSaveError(
          error instanceof Error ? error.message : "Try saving again.",
        );
      throw error;
    } finally {
      setSavingDraft(false);
    }
  }
  async function checkSavedRevision() {
    if (!edit) return;
    const generation = editGeneration.current;
    const draftId = edit.draftId;
    const refreshed = await load();
    if (currentDraft.current !== draftId) return;
    const latest = refreshed?.drafts.find((r) => r.draftId === edit.draftId);
    if (!latest)
      throw new Error(
        "Saved draft status is unavailable. Your local edits are still kept in this tab.",
      );
    if (reviewsPending.current.size)
      throw new Error(
        "Save or discard your private review changes before reconciling the draft.",
      );
    const parsed = parseCaptions(captionText, edit.end - edit.start);
    const matches =
      parsed.valid &&
      ["title", "messageId", "assetId", "start", "end"].every(
        (key) => Reflect.get(latest, key) === Reflect.get(edit, key),
      ) &&
      JSON.stringify(latest.captions) === JSON.stringify(parsed.captions);
    if (
      matches &&
      latest.version > edit.version &&
      generation === editGeneration.current
    ) {
      dirty.current = false;
      setEdit(latest);
      setSaveError("");
      setSaveUncertain(false);
      setNotice(
        "The saved revision was confirmed. Your draft is saved privately.",
      );
    } else {
      setSavedComparison(latest);
      setNotice(
        "Latest saved revision loaded for comparison. Your local edits have not been replaced.",
      );
    }
  }
  function openRevision(r: Revision, m: Message, a: Asset) {
    loadGeneration.current++;
    setData((current) =>
      current
        ? {
            ...current,
            assets: current.assets.some((v) => v.id === a.id)
              ? current.assets
              : [...current.assets, a],
            drafts: [
              ...current.drafts.filter((v) => v.draftId !== r.draftId),
              r,
            ],
            messages: current.messages.some((v) => v.id === m.id)
              ? current.messages
              : [...current.messages, m],
          }
        : current,
    );
    createdMessage.current = undefined;
    if (dirty.current || reviewsPending.current.size) {
      setNotice(
        "A new private exchange was saved in the review queue. Your current unsaved edits remain open.",
      );
      return false;
    }
    dirty.current = false;
    setSelected(r.draftId);
    setEdit(r);
    setCaptionText(formatCaptionText(r.captions));
    setRecordingUndo(undefined);
    createdMessage.current = undefined;
    setTab("review");
    return true;
  }
  async function newDraft(
    a = data?.assets.at(-1),
    complete = false,
    original?: Message,
  ) {
    if (!canLeave()) return false;
    const m =
      original ??
      createdMessage.current ??
      data?.messages.findLast((m) => !m.removed);
    if (!m || !a) {
      setSetup(true);
      throw new Error("Add a message and recording to create an exchange.");
    }
    if (m.removed)
      throw new Error(
        "This message was removed. Choose another original message.",
      );
    const id = crypto.randomUUID();
    const signal = AbortSignal.timeout(8000);
    let r: Revision;
    try {
      r = Revision.parse(
        await api(
          "creator/drafts/" + id,
          "PUT",
          {
            expectedVersion: 0,
            messageId: m.id,
            assetId: a.id,
            start: 0,
            end: Math.min(a.duration, complete ? 180 : 30),
            title: "A reply worth keeping",
            captions: [],
          },
          signal,
        ),
      );
    } catch (error) {
      if (signal.aborted)
        throw new Error(
          "Saving took too long. The draft may have been saved. Check Review exchanges before trying again.",
        );
      throw error;
    }
    const focused = openRevision(r, m, a);
    if (focused)
      setNotice(
        "Private exchange created. Preview the source and adjust the interval.",
      );
    return { focused };
  }
  async function connectMessage(message: Message, a: Asset) {
    if (actionRunning.current)
      throw new Error("Wait for the current action to finish.");
    actionRunning.current = true;
    setBusy(true);
    try {
      const result = await newDraft(a, false, message);
      if (!result)
        throw new Error(
          "Save or discard your current changes before creating an exchange.",
        );
      setNotice("Private exchange created from the selected original message.");
    } finally {
      setBusy(false);
      actionRunning.current = false;
    }
  }
  async function saveObsExchange() {
    if (!canLeave()) return false;
    capturingSnapshot.current = true;
    try {
      const segments = data?.obsSegments ?? [];
      const tail = segments.at(-1);
      if (!tail)
        throw new Error(
          "Wait for a closed OBS segment, or import a finalized recording.",
        );
      const selected = [tail];
      let duration = data?.assets.find((a) => a.id === tail.id)?.duration ?? 0;
      for (
        let i = segments.length - 2;
        i >= 0 && selected.length < obsCount;
        i--
      ) {
        const s = segments[i],
          next = selected[0],
          a = data?.assets.find((a) => a.id === s?.id);
        if (
          !s ||
          !next ||
          !a ||
          !s.epoch ||
          s.epoch !== next.epoch ||
          s.sequence + 1 !== next.sequence ||
          duration + a.duration > 180
        )
          break;
        selected.unshift(s);
        duration += a.duration;
      }
      const a = Asset.parse(
        await api(
          "creator/obs/snapshot",
          "POST",
          {
            assetIds: selected.map((s) => s.id),
          },
          AbortSignal.timeout(120000),
        ),
      );
      loadGeneration.current++;
      setData((current) =>
        current
          ? {
              ...current,
              assets: [...current.assets.filter((v) => v.id !== a.id), a],
            }
          : current,
      );
      try {
        await load();
      } catch {
        setConnectionError(
          "OBS snapshot saved; reconnect Studio before creating an exchange.",
        );
        setNotice(
          "Closed OBS footage saved. Reconnect Studio, then choose it in Received chat.",
        );
        return false;
      }
      capturingSnapshot.current = false;
      const result = await newDraft(a, true);
      if (!result) return false;
      if (result.focused)
        setNotice(
          `Saved ${time(a.duration)} of closed OBS footage across ${selected.length} segment(s). Preview the complete response and correct the message. The current recording file is still in progress.`,
        );
    } finally {
      capturingSnapshot.current = false;
    }
  }
  const drafts =
    data?.drafts.filter((r) => {
      const m = data.messages.find((m) => m.id === r.messageId);
      return (r.title + " " + m?.author + " " + m?.text)
        .toLowerCase()
        .includes(query.toLowerCase());
    }) ?? [];
  const reviewMessages = [
    ...(data?.messages ?? []),
    ...(pickedMessage && !data?.messages.some((m) => m.id === pickedMessage.id)
      ? [pickedMessage]
      : []),
  ];
  const message = reviewMessages.find((m) => m.id === edit?.messageId);
  const reviewIndex = drafts.findIndex((r) => r.draftId === edit?.draftId);
  const asset = data?.assets.find((a) => a.id === edit?.assetId);
  const editPublication = data?.publications.find(
    (p) => p.revisionId === edit?.id,
  );
  const finishedPublication = data?.publications.find(
    (p) => p.id === renderCompleted && p.state === "published",
  );
  const published =
    data?.publications.filter((p) => p.state === "published") ?? [];
  const libraryMatches = published.filter((p) => {
    const approved = data?.publicationContent.find(
      (r) => r.publicationId === p.id,
    );
    const original = data?.messages.find((m) => m.id === approved?.messageId);
    return (
      !query ||
      [approved?.title, original?.author, original?.text]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase())
    );
  });
  const captureTools = (
    <>
      {data && (
        <CaptureReadiness
          data={data}
          offline={Boolean(connectionError)}
          browserRecording={recording}
        />
      )}
      <AssistanceActivity />{" "}
      {Boolean(data?.obsSegments.length) && (
        <div className="obs-save">
          <label>
            Recent closed OBS footage
            <select
              value={obsCount}
              onChange={(e) => setObsCount(Number(e.target.value))}
            >
              <option value={1}>Latest segment</option>
              <option value={3}>Up to 90 seconds</option>
              <option value={5}>Up to 150 seconds</option>
            </select>
          </label>
          <button
            className="secondary wide"
            disabled={busy}
            onClick={() => void action(saveObsExchange, "")}
          >
            Save OBS exchange
          </button>
          <p className="fine">
            Only contiguous closed segments are included. Recording gaps end the
            selection. Review the start and ending; import the original for a
            longer answer.
          </p>
        </div>
      )}{" "}
    </>
  );
  return (
    <div className={"shell" + (edit ? " editing" : "")}>
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
            onClick={() => navigate("review")}
          >
            <i aria-hidden="true">▧</i> <span>Review exchanges</span>
            <em aria-hidden="true">{data?.drafts.length ?? 0}</em>
          </button>
          <button
            className={tab === "library" ? "active" : ""}
            onClick={() => navigate("library")}
          >
            <i aria-hidden="true">↗</i> <span>Published replies</span>
            <em aria-hidden="true">{published.length}</em>
          </button>
          <button
            className={tab === "chat" ? "active" : ""}
            onClick={() => navigate("chat")}
          >
            <i aria-hidden="true">☵</i>
            <span>Received chat</span>
            <em aria-hidden="true">{data?.twitchMessageCount ?? 0}</em>
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
          <div className="header-actions">
            <ThemeToggle />
            <button className="subtle" onClick={() => setSetup(true)}>
              ⚙ Setup <span className="avatar small">a</span>
            </button>
          </div>
        </header>
        <div className="content">
          <div className="heading">
            <div>
              <p className="eyebrow">EVERY REPLY HAS A REPLAY</p>
              <h1>
                {edit ? (
                  "Make the connection."
                ) : tab === "chat" ? (
                  "Every message has a voice."
                ) : tab === "library" ? (
                  "Kept for the replay."
                ) : (
                  <>
                    Good conversations
                    <br />
                    <span className="heading-accent">deserve to stay.</span>
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
                ? captureProgress || "Recording selected source"
                : "Browser capture stopped"}
            </span>
            <span>
              ↯ Twitch:{" "}
              {connectionError
                ? "Status unavailable"
                : (data?.twitch ?? "Checking…")}
            </span>
            <span>
              {connectionError ? "OBS status unavailable" : data?.obs}
            </span>
            <span>
              {connectionError
                ? "Suggestion status unavailable"
                : data?.assistance}
            </span>
            <span>▣ {data?.assets.length ?? 0} recordings saved</span>
            <button onClick={() => setSetup(true)}>Manage sources ↗</button>
          </div>
          {connectionError && (
            <div className="connection-alert" role="alert">
              <div>
                <strong>Studio offline</strong>
                <p>{connectionError}</p>
                {lastUpdated && <small>Last update {lastUpdated}</small>}
              </div>
              <button onClick={() => void reconnect()}>Reconnect studio</button>
            </div>
          )}
          {edit ? (
            <details className="editor-source-details">
              <summary>Capture tools & saved footage</summary>
              <h2 className="review-pane-heading">Capture & sources</h2>
              {captureTools}
            </details>
          ) : (
            captureTools
          )}
          {finishedPublication &&
            finishedPublication.id !== editPublication?.id && (
              <section
                className="render-complete-notice"
                aria-label="Render notification"
                aria-live="polite"
              >
                <div>
                  <strong>✓ Replay rendered</strong>
                  <p>Your approved replay is ready to watch.</p>
                </div>
                <a
                  href={`/r/${finishedPublication.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open rendered replay ↗
                </a>
                <button
                  className="subtle"
                  aria-label="Dismiss render notification"
                  onClick={() => setRenderCompleted(undefined)}
                >
                  ×
                </button>
              </section>
            )}
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

          <ReaderSyncStatus
            sync={data?.synchronization ?? []}
            publications={data?.publications ?? []}
            content={data?.publicationContent ?? []}
            busy={busy || Boolean(connectionError)}
            onRetry={(id) =>
              void action(
                () => api("creator/synchronization/" + id + "/retry", "POST"),
                "Reader synchronization queued again.",
              )
            }
          />
          <div
            role="status"
            aria-live="polite"
            className={busy || notice ? "notice" : "sr-only"}
          >
            {busy
              ? savingDraft
                ? "Saving private draft…"
                : "Working on your action…"
              : notice}
          </div>
          {edit ? (
            <section className="editor">
              <div
                className="review-navigation"
                role="group"
                aria-label="Exchange navigation"
              >
                <button className="back" onClick={() => navigate("review")}>
                  ← All exchanges
                </button>
                <span className="fine">
                  {reviewIndex >= 0
                    ? `Exchange ${reviewIndex + 1} of ${drafts.length}`
                    : "Saved exchange"}
                </span>
                <div>
                  <button
                    className="subtle"
                    disabled={busy || savingDraft || reviewIndex <= 0}
                    onClick={() => moveExchange(-1)}
                  >
                    ← Previous exchange
                  </button>
                  <button
                    className="subtle"
                    disabled={
                      busy ||
                      savingDraft ||
                      reviewIndex < 0 ||
                      reviewIndex >= drafts.length - 1
                    }
                    onClick={() => moveExchange(1)}
                  >
                    Next exchange →
                  </button>
                </div>
              </div>
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
                        if (
                          e.currentTarget.currentTime >=
                          (previewLimit.current ?? edit.end)
                        )
                          e.currentTarget.pause();
                      }}
                    >
                      <DraftCaptionTrack
                        text={captionText}
                        sourceStart={edit.start}
                        duration={edit.end - edit.start}
                      />
                    </video>
                  </div>
                  {captionText.trim() && (
                    <p className="fine draft-caption-hint">
                      {parseCaptions(captionText, edit.end - edit.start).valid
                        ? "Private caption preview · edited words, original recorded speech. Use CC to show or hide."
                        : "Caption preview paused. Finish valid caption text and timing in the Captions tab."}
                    </p>
                  )}
                  <ReviewTools
                    key={edit.draftId}
                    captionCount={
                      parseCaptions(captionText, edit.end - edit.start).rows
                        .length
                    }
                    response={
                      <>
                        <ResponseTimeline
                          assetId={edit.assetId}
                          start={edit.start}
                          end={edit.end}
                          duration={asset?.duration ?? 0}
                          player={player}
                          onChange={change}
                        />
                        <div className="trim">
                          <div>
                            <b>Response interval</b>
                            <button
                              onClick={() => {
                                if (player.current) {
                                  previewLimit.current = undefined;
                                  player.current.currentTime = edit.start;
                                  void player.current
                                    .play()
                                    .catch(() =>
                                      setNotice(
                                        "Use the video play control to preview this interval.",
                                      ),
                                    );
                                }
                              }}
                            >
                              ▶ Preview selection
                            </button>
                            <button
                              onClick={() => {
                                if (player.current) {
                                  previewLimit.current = undefined;
                                  player.current.currentTime = Math.max(
                                    0,
                                    edit.start - 5,
                                  );
                                  void player.current
                                    .play()
                                    .catch(() =>
                                      setNotice(
                                        "Use the video play control to preview this lead-in.",
                                      ),
                                    );
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
                            Only this interval becomes public. Preview the
                            opening and closing words.
                          </p>
                        </div>
                      </>
                    }
                    captions={
                      <>
                        <h2 className="review-pane-heading">
                          Transcript & captions
                        </h2>
                        <TranscriptReview
                          revision={edit}
                          dirty={dirty.current}
                          captionText={captionText}
                          onApply={(captions) => change({ captions })}
                          onPreview={(start, end) => {
                            previewLimit.current = end;
                            if (player.current) {
                              player.current.currentTime = start;
                              void player.current
                                .play()
                                .catch(() =>
                                  setNotice(
                                    "Use the video play control to preview these words.",
                                  ),
                                );
                            }
                          }}
                          onSelect={(start, end, text, messageId, captions) => {
                            previewLimit.current = undefined;
                            change({
                              start,
                              end,
                              captions: captions ?? [
                                { start: 0, end: end - start, text },
                              ],
                              ...(messageId ? { messageId } : {}),
                            });
                            if (player.current) {
                              player.current.currentTime = start;
                              void player.current
                                .play()
                                .catch(() =>
                                  setNotice(
                                    "Use the video play control to preview this reply.",
                                  ),
                                );
                            }
                          }}
                        />
                        <CaptionEditor
                          text={captionText}
                          duration={edit.end - edit.start}
                          onPreview={(start) => {
                            previewLimit.current = undefined;
                            if (player.current) {
                              player.current.currentTime = edit.start + start;
                              void player.current
                                .play()
                                .catch(() =>
                                  setNotice(
                                    "Use the video play control to preview this caption.",
                                  ),
                                );
                            }
                          }}
                          onChange={(text) => {
                            setCaptionText(text);
                            dirty.current = true;
                            editGeneration.current++;
                            setSaveError("");
                            const parsed = parseCaptions(
                              text,
                              edit.end - edit.start,
                            );
                            if (parsed.valid)
                              setEdit({ ...edit, captions: parsed.captions });
                          }}
                        />{" "}
                      </>
                    }
                    evidence={
                      <>
                        <h2 className="review-pane-heading">
                          Source evidence & assessments
                        </h2>
                        <p className="fine">
                          Original suggestion evidence and private notes stay
                          separate from your edited replay.
                        </p>
                        <SuggestionEvidence
                          onPending={onReviewPending}
                          draftId={edit.draftId}
                          assetId={edit.assetId}
                          onPreview={(seconds, end) => {
                            if (player.current) {
                              previewLimit.current = end;
                              player.current.currentTime = seconds;
                              void player.current
                                .play()
                                .catch(() =>
                                  setNotice(
                                    "Use the video play control to preview this original range.",
                                  ),
                                );
                            }
                          }}
                        />
                        <ReviewNotes
                          key={edit.id}
                          onPending={onReviewPending}
                          revisionId={edit.id}
                          version={edit.version}
                          dirty={dirty.current}
                        />{" "}
                      </>
                    }
                  />
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
                  {message?.removed && (
                    <p className="sample" role="alert">
                      This original message was removed. Choose an available
                      message before saving or approving.
                    </p>
                  )}
                  <label className="field">
                    Connect a different message
                    <select
                      aria-label="Connect a different message"
                      value={edit.messageId}
                      onChange={(e) => {
                        pickedMessageId.current = undefined;
                        setPickedMessage(undefined);
                        change({ messageId: e.target.value });
                      }}
                    >
                      {(!message || message.removed) && (
                        <option value={edit.messageId} disabled>
                          {message?.removed
                            ? "Original message removed"
                            : "Original message unavailable"}{" "}
                          · choose another
                        </option>
                      )}
                      {reviewMessages
                        .filter((m) => !m.removed)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            @{m.author}: {m.text}
                          </option>
                        ))}
                    </select>
                  </label>
                  <MessageSearch
                    disabled={Boolean(connectionError) || busy || savingDraft}
                    onPick={(value) => {
                      pickedMessageId.current = value.id;
                      setPickedMessage(value);
                      change({ messageId: value.id });
                      setNotice(
                        "Original message selected. Save this private revision before approval.",
                      );
                    }}
                  />
                  {!message && (
                    <p className="sample" role="alert">
                      Original message unavailable. Choose an available message
                      before saving or approving.
                    </p>
                  )}
                  <label className="field">
                    Recording
                    <select
                      value={edit.assetId}
                      onChange={(e) => {
                        const a = data?.assets.find(
                          (a) => a.id === e.target.value,
                        );
                        if (a) {
                          setRecordingUndo({
                            revision: edit,
                            captions: captionText,
                          });
                          change({
                            assetId: a.id,
                            start: 0,
                            end: Math.min(a.duration, 30),
                            captions: [],
                          });
                        }
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
                  {recordingUndo?.revision.draftId === edit.draftId && (
                    <div className="recording-undo">
                      <p className="fine">
                        Changing recordings starts a new interval and clears
                        incompatible captions.
                      </p>
                      <button
                        className="secondary"
                        onClick={() => {
                          dirty.current = true;
                          editGeneration.current++;
                          setEdit({
                            ...edit,
                            assetId: recordingUndo.revision.assetId,
                            start: recordingUndo.revision.start,
                            end: recordingUndo.revision.end,
                            captions: recordingUndo.revision.captions,
                          });
                          setCaptionText(recordingUndo.captions);
                          setRecordingUndo(undefined);
                          setSaveError("");
                          setNotice(
                            "Previous recording, interval and caption edits restored. Save to keep them.",
                          );
                        }}
                      >
                        Undo recording change
                      </button>
                    </div>
                  )}
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
                  {dirty.current && (
                    <button
                      className="wide subtle"
                      disabled={savingDraft}
                      onClick={revert}
                    >
                      Revert unsaved changes
                    </button>
                  )}
                  <button
                    disabled={busy || savingDraft || Boolean(connectionError)}
                    className={
                      "wide secondary" +
                      (!dirty.current && !saveError
                        ? " draft-saved-button"
                        : "")
                    }
                    onClick={() => void action(save, "")}
                  >
                    {savingDraft
                      ? "Saving private draft…"
                      : "Save private draft"}
                  </button>
                  <div
                    className={
                      "draft-save-state " +
                      (savingDraft
                        ? "saving"
                        : saveError
                          ? "failed"
                          : dirty.current
                            ? "unsaved"
                            : "saved")
                    }
                    data-testid="draft-save-state"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    <span aria-hidden="true">
                      {savingDraft
                        ? "◌"
                        : saveError
                          ? "!"
                          : dirty.current
                            ? "●"
                            : "✓"}
                    </span>
                    <div>
                      <strong>
                        {savingDraft
                          ? "Saving your private draft…"
                          : saveError
                            ? saveUncertain
                              ? "Save not confirmed"
                              : "Draft not saved"
                            : dirty.current
                              ? "Unsaved changes"
                              : "Saved privately"}
                      </strong>
                      <small>
                        {saveError ||
                          (dirty.current
                            ? "Save these changes before transcription or approval."
                            : `Revision ${edit.version} · saved ${new Date(edit.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`)}
                      </small>
                    </div>
                  </div>
                  {saveError && (
                    <button
                      className="wide secondary"
                      disabled={busy}
                      onClick={() => void action(checkSavedRevision, "")}
                    >
                      Check saved revision
                    </button>
                  )}
                  {savedComparison &&
                    savedComparison.draftId === edit.draftId && (
                      <section
                        className="draft-recovery"
                        aria-label="Saved draft comparison"
                      >
                        <p>
                          Latest saved revision {savedComparison.version}:{" "}
                          {savedComparison.title} ·{" "}
                          {time(savedComparison.start)}–
                          {time(savedComparison.end)}. Your local edits are
                          still in this editor.
                        </p>
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (reviewsPending.current.size) {
                              setNotice(
                                "Save or discard your private review changes before reconciling this draft.",
                              );
                              return;
                            }
                            setEdit({
                              ...edit,
                              id: savedComparison.id,
                              version: savedComparison.version,
                              createdAt: savedComparison.createdAt,
                            });
                            dirty.current = true;
                            editGeneration.current++;
                            setSavedComparison(undefined);
                            setSaveError("");
                            setSaveUncertain(false);
                            setNotice(
                              "Your edits are kept for a new revision. Review and save them explicitly.",
                            );
                          }}
                        >
                          Keep my edits for a new revision
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (reviewsPending.current.size) {
                              setNotice(
                                "Save or discard your private review changes before reconciling this draft.",
                              );
                              return;
                            }
                            dirty.current = false;
                            setEdit(savedComparison);
                            setCaptionText(
                              formatCaptionText(savedComparison.captions),
                            );
                            setSavedComparison(undefined);
                            setSaveError("");
                            setSaveUncertain(false);
                          }}
                        >
                          Use latest saved revision
                        </button>
                      </section>
                    )}
                  <section
                    className="approval-controls"
                    ref={approvalControls}
                    tabIndex={-1}
                    aria-label="Publication approval"
                  >
                    <button
                      disabled={
                        busy ||
                        Boolean(connectionError) ||
                        !message ||
                        message.removed ||
                        dirty.current ||
                        savingDraft ||
                        Boolean(editPublication)
                      }
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
                          setJustApproved(edit.id);
                        }, "Exact revision approved. Rendering a separate replay file.")
                      }
                    >
                      {editPublication
                        ? `Revision ${edit.version} approved · ${renderLabel(editPublication.state)}`
                        : `Approve revision ${edit.version} & publish locally ↗`}
                    </button>
                    {editPublication && (
                      <div
                        className={
                          "approval-connection" +
                          (justApproved === edit.id ? " approval-joined" : "")
                        }
                        aria-hidden="true"
                      >
                        <span>Message</span>
                        <i />
                        <span>Response</span>
                      </div>
                    )}
                    {editPublication && (
                      <RenderStatus
                        publication={editPublication}
                        version={edit.version}
                        dirty={dirty.current}
                        busy={busy}
                        onRetry={() =>
                          void action(
                            () =>
                              api(
                                `creator/publications/${editPublication.id}/retry-render`,
                                "POST",
                              ),
                            "Retry queued for the same approved revision.",
                          )
                        }
                      />
                    )}
                  </section>
                  <button
                    className="wide danger"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        if (reviewsPending.current.size)
                          throw new Error(
                            "Save or discard your private review changes before discarding this draft.",
                          );
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
              <section className="review-dock" aria-label="Review actions">
                <p aria-live="polite" data-testid="review-dock-state">
                  <strong>
                    {savingDraft
                      ? "Saving…"
                      : saveError
                        ? "Save needs attention"
                        : dirty.current
                          ? "Unsaved changes"
                          : `Revision ${edit.version} saved`}
                  </strong>
                  <small>
                    {connectionError
                      ? "Studio offline"
                      : dirty.current
                        ? "Your changes are private."
                        : editPublication
                          ? renderLabel(editPublication.state)
                          : "Ready for your review."}
                  </small>
                </p>
                <div>
                  <button
                    className="secondary"
                    disabled={
                      busy ||
                      savingDraft ||
                      Boolean(connectionError) ||
                      (!dirty.current && !saveError)
                    }
                    onClick={() => void action(save, "")}
                  >
                    {savingDraft ? "Saving changes…" : "Save changes"}
                  </button>
                  <button className="primary" onClick={showApproval}>
                    {editPublication ? "View replay status" : "Review approval"}
                  </button>
                </div>
              </section>
            </section>
          ) : tab === "chat" ? (
            <ChatInbox
              messages={data?.messages ?? []}
              assets={data?.assets ?? []}
              busy={busy}
              offline={Boolean(connectionError)}
              onSetup={() => setSetup(true)}
              onReview={() => navigate("review")}
              onCreate={connectMessage}
            />
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
                    onClick={() => void action(newDraft, "")}
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
                          {data?.suggestionProvenance.find(
                            (s) => s.draftId === r.draftId,
                          ) && (
                            <p className="fine">
                              Local suggestion ·{" "}
                              {
                                data.suggestionProvenance.find(
                                  (s) => s.draftId === r.draftId,
                                )?.sourceAssetIds.length
                              }{" "}
                              closed segment(s). Review the message and response
                              boundaries.
                            </p>
                          )}
                          <div className="card-footer">
                            <span className="badge">
                              {p ? renderLabel(p.state) : "Private draft"}
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
                  {libraryMatches.map((p) => (
                    <article className="card publication" key={p.id}>
                      <p className="eyebrow">APPROVED REPLAY</p>
                      <h3>
                        {data?.publicationContent.find(
                          (r) => r.publicationId === p.id,
                        )?.title ?? "Approved replay"}
                      </h3>
                      <p className="fine">
                        Approved revision{" "}
                        {data?.publicationContent.find(
                          (r) => r.publicationId === p.id,
                        )?.version ?? "—"}
                      </p>
                      <button
                        disabled={
                          busy ||
                          Boolean(connectionError) ||
                          ["queued", "uploading", "available"].includes(
                            data?.synchronization.find((s) => s.id === p.id)
                              ?.state ?? "",
                          )
                        }
                        className="secondary"
                        onClick={() =>
                          void action(
                            () =>
                              api(
                                "creator/publications/" + p.id + "/publish",
                                "POST",
                              ),
                            "Publishing approved replay to the reader…",
                          )
                        }
                      >
                        {data?.synchronization.find((s) => s.id === p.id)
                          ?.state === "available"
                          ? "Published to reader"
                          : ["queued", "uploading"].includes(
                                data?.synchronization.find((s) => s.id === p.id)
                                  ?.state ?? "",
                              )
                            ? "Publishing to reader…"
                            : "Publish to reader"}
                      </button>
                      <p className="fine">
                        Reader:{" "}
                        {data?.synchronization.find((s) => s.id === p.id)
                          ?.state ?? "Not published"}
                      </p>
                      {data?.synchronization.find((s) => s.id === p.id)
                        ?.state === "available" && (
                        <>
                          <a
                            href={data.readerUrl + "/r/" + p.id}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open reader replay ↗
                          </a>
                          <a
                            href={
                              data.readerUrl +
                              "/api/public/replies/" +
                              p.id +
                              "/preview"
                            }
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open share preview ↗
                          </a>
                        </>
                      )}
                      <a
                        className="button primary"
                        href={"/r/" + p.id}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open replay ↗
                      </a>
                      <button
                        disabled={
                          busy ||
                          Boolean(connectionError) ||
                          !data?.readerUrl.startsWith("https://") ||
                          data?.synchronization.find((s) => s.id === p.id)
                            ?.state !== "available"
                        }
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
                      {(!data?.readerUrl.startsWith("https://") ||
                        data?.synchronization.find((s) => s.id === p.id)
                          ?.state !== "available") && (
                        <p className="fine">
                          Twitch sharing requires a published HTTPS reader
                          replay and separately authorized Twitch sharing
                          access. Local playback remains available.
                        </p>
                      )}
                      <button
                        disabled={busy}
                        onClick={() =>
                          void action(
                            () =>
                              api(
                                "creator/publications/" + p.id + "/portrait",
                                "POST",
                                undefined,
                                AbortSignal.timeout(120000),
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
                        disabled={busy || Boolean(connectionError)}
                        className="danger"
                        onClick={() =>
                          void action(
                            () => api("creator/publications/" + p.id, "DELETE"),
                            "Local replay removed. Reader withdrawal is tracked separately below.",
                          )
                        }
                      >
                        Unpublish
                      </button>
                    </article>
                  ))}
                </div>
              )}
              {(tab === "review" ? drafts.length : libraryMatches.length) ===
                0 && (
                <div className="empty">
                  <span>↳</span>
                  <h2>
                    {query
                      ? "No exchanges match your search."
                      : tab === "review"
                        ? "Your next good conversation starts here."
                        : "Nothing public until you say so."}
                  </h2>
                  <p>
                    {query
                      ? "Try a title, viewer name or original message, or clear the search."
                      : "Import a recording, add a source message, and connect the two."}
                  </p>
                  {query ? (
                    <button className="secondary" onClick={() => setQuery("")}>
                      Clear exchange search
                    </button>
                  ) : (
                    <button className="primary" onClick={() => setSetup(true)}>
                      Set up your sources ↗
                    </button>
                  )}
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
            <p className="fine setup-status" aria-live="polite">
              {busy || startingCapture ? "Working on your request…" : notice}
            </p>
            <p className="fine">
              <a href="/api/creator/reviews/export" download>
                Download private review dataset
              </a>{" "}
              · Includes reviewed messages, saved captions and quality notes.
              This local export is separate from publishing.
            </p>
            <p className="fine">
              <a href="/api/creator/proposal-reviews/export" download>
                Download original suggestion assessments
              </a>{" "}
              · Untouched proposals, raw ASR and your assessments, kept separate
              from corrected revisions.
            </p>
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
                            AbortSignal.timeout(120000),
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
            <p className="fine">
              OBS: {data?.obs}. Choose OBS_RECORD_DIR and OBS_AUDIO_TRACK in
              local .env, then enable its authenticated WebSocket. Wait for a
              closed segment before saving. Original OBS files remain untouched.
            </p>
            <div className="obs-capture-guide">
              <h3>Using an OBS window source</h3>
              <ol>
                <li>
                  In OBS, select the intended window using a PipeWire capture
                  source on Fedora Wayland. Check OBS’s preview first.
                </li>
                <li>
                  Start Recording in OBS with your intended recorded audio mix.
                  ReplyLink reads the active scene; it does not choose a window.
                </li>
                <li>
                  Allow roughly 60 seconds for the first usable closed segment,
                  then choose Save OBS exchange here.
                </li>
              </ol>
              <p className="fine">
                The browser capture button below is a separate recording source.
                Browser window sharing may not include audio on Linux. For a
                read-only connection/source check, run{" "}
                <code>npm run obs:doctor</code>.
              </p>
            </div>
            <div className="setup-choice">
              <h3>01 / Bring the recording</h3>
              <button
                className="primary"
                disabled={startingCapture || Boolean(recorder.current)}
                onClick={() => void capture()}
              >
                {startingCapture
                  ? "Choosing recording source…"
                  : "Choose screen or tab ↗"}
              </button>
              <label className="file-label">
                Import a recording
                <input
                  type="file"
                  accept="video/*,.mkv"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      const input = e.currentTarget;
                      void action(
                        () => upload(f),
                        "Recording saved. Verify sound and sync in review.",
                      ).finally(() => {
                        input.value = "";
                      });
                    }
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
                const submitted = manualSource;
                void action(async () => {
                  await api("creator/messages", "POST", submitted);
                  setManualSource((current) =>
                    current.author === submitted.author &&
                    current.text === submitted.text
                      ? { author: "", text: "" }
                      : current,
                  );
                }, "Manually entered source message saved.");
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
                  value={manualSource.author}
                  onChange={(e) =>
                    setManualSource((current) => ({
                      ...current,
                      author: e.target.value,
                    }))
                  }
                  required
                  maxLength={80}
                  placeholder="mira"
                />
              </label>
              <label className="field">
                Original message
                <textarea
                  name="text"
                  value={manualSource.text}
                  onChange={(e) =>
                    setManualSource((current) => ({
                      ...current,
                      text: e.target.value,
                    }))
                  }
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
              disabled={
                busy ||
                Boolean(manualSource.author.trim() || manualSource.text.trim())
              }
              onClick={() => {
                setSetup(false);
                void action(newDraft, "");
              }}
            >
              03 / Create an exchange →
            </button>
            {(manualSource.author.trim() || manualSource.text.trim()) && (
              <p className="fine">
                Save the entered manual message before creating its exchange.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
