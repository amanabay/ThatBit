import { useState, useEffect, useRef } from "react";
import {
  AnalysisResult,
  type Transcript,
} from "../../../../shared/contracts/intelligence.ts";
import type { Revision, Caption } from "../../../../shared/contracts/models.ts";
import { api, time } from "../client.ts";
import {
  mergeTranscriptCaptions,
  transcriptCaptions,
} from "./transcript-selection.ts";
export function TranscriptReview({
  revision,
  dirty,
  captionText,
  onSelect,
  onApply,
  onPreview,
}: {
  revision: Revision;
  dirty: boolean;
  captionText: string;
  onApply: (captions: Caption[]) => void;
  onPreview: (start: number, end?: number) => void;
  onSelect: (
    start: number,
    end: number,
    text: string,
    messageId?: string,
    captions?: Caption[],
  ) => void;
}) {
  const [result, setResult] =
    useState<ReturnType<typeof AnalysisResult.parse>>();
  const [source, setSource] = useState<{
    draftId: string;
    transcript: Transcript;
  }>();
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [selection, setSelection] = useState<{ from: number; to: number }>();
  const [pending, setPending] = useState(false);
  const requesting = useRef(false);
  const generation = useRef(0);
  const reads = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    let polling = false;
    setResult(undefined);
    setError("");
    setLoadError("");
    setFeedback("");
    const poll = async () => {
      if (polling || requesting.current) return;
      polling = true;
      const read = ++reads.current;
      try {
        const value = AnalysisResult.parse(
          await api(
            "creator/analysis/" + revision.id,
            "GET",
            undefined,
            AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
          ),
        );
        if (controller.signal.aborted || read !== reads.current) return;
        setResult(value);
        setLoadError("");
        if (value.transcript)
          setSource({
            draftId: revision.draftId,
            transcript: value.transcript,
          });
      } catch (e) {
        if (
          !controller.signal.aborted &&
          current === generation.current &&
          read === reads.current
        )
          setLoadError(
            e instanceof Error ? e.message : "Analysis unavailable.",
          );
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [revision.id, revision.draftId]);
  const transcript =
    source?.draftId === revision.draftId &&
    source.transcript.assetId === revision.assetId
      ? source.transcript
      : undefined;
  useEffect(() => {
    setSelection(undefined);
    setFeedback("");
  }, [transcript?.id]);
  const job = result?.job;
  const active = job?.state === "queued" || job?.state === "running";
  const blocked = pending || Boolean(result?.stale) || !transcript;
  const selected =
    transcript?.segments.filter(
      (_s, i) => selection && i >= selection.from && i <= selection.to,
    ) ?? [];
  const first = selected[0],
    last = selected.at(-1);
  const withinReply =
    selected.length > 0 &&
    selected.every((s) => s.start >= revision.start && s.end <= revision.end);
  const inReply = transcriptCaptions(
    transcript?.segments ?? [],
    revision.start,
    revision.end,
  );
  async function request(cancel = false) {
    if (requesting.current) return;
    requesting.current = true;
    const current = generation.current;
    reads.current++;
    setPending(true);
    setError("");
    try {
      const signal = AbortSignal.timeout(8000);
      if (cancel)
        await api(
          "creator/analysis/" + revision.id,
          "DELETE",
          undefined,
          signal,
        );
      else
        await api(
          "creator/drafts/" + revision.draftId + "/transcribe",
          "POST",
          { version: revision.version },
          signal,
        );
      const value = AnalysisResult.parse(
        await api("creator/analysis/" + revision.id, "GET", undefined, signal),
      );
      if (current !== generation.current) return;
      setResult(value);
      if (value.transcript)
        setSource({ draftId: revision.draftId, transcript: value.transcript });
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : "Analysis unavailable.");
    } finally {
      requesting.current = false;
      setPending(false);
    }
  }
  function selectRange(from: number, to: number) {
    setSelection({ from, to });
    setFeedback("");
  }
  return (
    <section aria-label="Transcript assistance">
      <button
        className="secondary wide"
        disabled={pending || active || dirty}
        onClick={() => void request()}
      >
        {pending
          ? "Updating local transcription…"
          : active
            ? "Analysis " + job.state + "…"
            : job?.state === "failed" || job?.state === "cancelled"
              ? "Retry local transcription"
              : "Transcribe selected interval locally"}
      </button>
      {active && (
        <button
          className="wide"
          disabled={pending}
          onClick={() => void request(true)}
        >
          Cancel analysis
        </button>
      )}
      <p
        className={
          error || loadError || job?.state === "failed" ? "sample" : "fine"
        }
        aria-live="polite"
      >
        {error ||
          loadError ||
          job?.error ||
          (active
            ? "You can leave this draft. Analysis is saved and resumes after restart."
            : transcript
              ? transcript.segments.length
                ? "Local transcript ready. Verify against actual footage."
                : "No speech was detected; captions were not generated. Play the saved clip and check the recorded audio."
              : "Manual review works without transcription.")}
      </p>
      {dirty && (
        <p className="fine">
          Save the private draft before starting new transcription. You can
          still select, preview and apply words from this recording’s existing
          transcript.
        </p>
      )}
      {result?.stale && (
        <p className="sample">
          This saved revision is out of date. Reopen the latest draft before
          applying transcript results.
        </p>
      )}
      {source && !transcript && (
        <p className="sample">
          The existing transcript belongs to a different recording. Save and
          transcribe the selected recording to use its words.
        </p>
      )}
      {result?.suggestions.map((s, i) => (
        <button
          className="secondary wide"
          key={i}
          disabled={dirty || blocked}
          onClick={() => onSelect(s.start, s.end, s.evidence, s.messageId)}
        >
          Suggested connection: {s.evidence}
        </button>
      ))}
      {transcript && (
        <>
          <p className="fine">
            {transcript.provider} · {transcript.model} · sentence timing
            estimates. Original transcript range {time(transcript.start)}–
            {time(transcript.end)} in this recording.{" "}
            {transcript.sourceRevisionId !== revision.id &&
              "Retained from an earlier saved revision of this draft."}
          </p>
          {transcript.segments.length > 0 && (
            <>
              <p className="fine">
                Select a sentence, or use Start/End range for several. Selection
                does not change the reply. Preview it before applying.
              </p>
              <div
                className="transcript-selection"
                aria-label="Transcript selection"
              >
                <p aria-live="polite">
                  {first && last
                    ? `${selected.length} ${selected.length === 1 ? "sentence" : "sentences"} selected · ${time(first.start)} → ${time(last.end)}`
                    : "No sentences selected."}
                </p>
                <div className="transcript-actions">
                  <button
                    className="secondary"
                    disabled={blocked || !first || !last}
                    onClick={() => {
                      if (first && last) onPreview(first.start, last.end);
                    }}
                  >
                    Preview selected sentences
                  </button>
                  <button
                    className="primary"
                    disabled={
                      blocked || !first || !last || selected.length > 300
                    }
                    onClick={() => {
                      if (!first || !last) return;
                      onSelect(
                        first.start,
                        last.end,
                        selected.map((s) => s.text).join(" "),
                        undefined,
                        transcriptCaptions(selected, first.start, last.end),
                      );
                      setFeedback(
                        "Selected sentences applied to the reply interval and captions. Save the private draft to keep these changes.",
                      );
                    }}
                  >
                    Use selected sentences for reply
                  </button>
                  <button
                    className="secondary"
                    disabled={blocked || !withinReply || selected.length > 300}
                    onClick={() => {
                      const merged = mergeTranscriptCaptions(
                        captionText,
                        transcriptCaptions(
                          selected,
                          revision.start,
                          revision.end,
                        ),
                        revision.end - revision.start,
                      );
                      if (merged.error) {
                        setFeedback(merged.error);
                        return;
                      }
                      onApply(merged.captions);
                      setFeedback(
                        "Selected captions added to this reply. Existing captions and the reply interval were kept. Save the private draft to keep these changes.",
                      );
                    }}
                  >
                    Add selected captions to reply
                  </button>
                  <button
                    disabled={!selection}
                    onClick={() => setSelection(undefined)}
                  >
                    Clear selection
                  </button>
                </div>
                {selected.length > 0 && !withinReply && (
                  <p className="fine">
                    These sentences fall outside the current reply. Use selected
                    sentences for reply to change its interval, or adjust the
                    boundaries first.
                  </p>
                )}
                <p className="fine">
                  Using selected sentences replaces the reply interval and its
                  caption rows. Adding captions keeps both existing rows and the
                  interval; overlapping captions need correction first.
                </p>
                <p className="transcript-feedback" aria-live="polite">
                  {feedback}
                </p>
              </div>
              <button
                className="secondary wide"
                disabled={blocked || !inReply.length || inReply.length > 300}
                onClick={() => {
                  onApply(inReply);
                  setFeedback(
                    "Transcript captions applied within the current reply. The interval is unchanged. Save the private draft to keep these changes.",
                  );
                }}
              >
                Use transcript within reply as captions
              </button>
              <p className="fine">
                Replaces caption rows with complete transcript sentences inside
                the current reply; the interval stays unchanged.{" "}
                {inReply.length === 0 &&
                  "No complete transcript sentences fit this interval."}
              </p>
            </>
          )}
          <div className="transcript">
            {transcript.segments.length === 0 && (
              <p>
                If your voice is absent, check OBS mute, device and
                recording-track routing, then record a new clip. Manual review
                remains available.
              </p>
            )}
            {transcript.segments.map((s, i) => (
              <div className="transcript-sentence" key={i}>
                <button
                  disabled={blocked}
                  aria-pressed={Boolean(
                    selection && i >= selection.from && i <= selection.to,
                  )}
                  aria-label={`Select sentence ${i + 1}: ${time(s.start)} · ${s.text}`}
                  onClick={() => {
                    selectRange(i, i);
                    onPreview(s.start, s.end);
                  }}
                >
                  {time(s.start)} · {s.text}
                </button>
                <div className="transcript-sentence-actions">
                  <button
                    disabled={blocked}
                    aria-label={`Start range here at sentence ${i + 1}`}
                    onClick={() => selectRange(i, i)}
                  >
                    Start range here
                  </button>
                  <button
                    disabled={blocked || !selection || selection.from > i}
                    aria-label={`End range here at sentence ${i + 1}`}
                    onClick={() => {
                      if (selection) selectRange(selection.from, i);
                    }}
                  >
                    End range here
                  </button>
                  <button
                    className="transcript-play"
                    aria-label={`Play from sentence ${i + 1}`}
                    disabled={blocked}
                    onClick={() => onPreview(s.start, s.end)}
                  >
                    ▶
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
