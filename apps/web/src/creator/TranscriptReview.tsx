import { useState, useEffect } from "react";
import { AnalysisResult } from "../../../../shared/contracts/intelligence.ts";
import type { Revision } from "../../../../shared/contracts/models.ts";
import { api, time } from "../client.ts";
export function TranscriptReview({
  revision,
  dirty,
  onSelect,
}: {
  revision: Revision;
  dirty: boolean;
  onSelect: (
    start: number,
    end: number,
    text: string,
    messageId?: string,
  ) => void;
}) {
  const [result, setResult] =
    useState<ReturnType<typeof AnalysisResult.parse>>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let alive = true;
    setResult(undefined);
    setError("");
    const poll = async () => {
      try {
        const value = AnalysisResult.parse(
          await api("creator/analysis/" + revision.id),
        );
        if (alive) setResult(value);
      } catch (e) {
        if (alive)
          setError(e instanceof Error ? e.message : "Analysis unavailable.");
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [revision.id]);
  const job = result?.job;
  const active = job?.state === "queued" || job?.state === "running";
  const stale = dirty || result?.stale;
  async function request(cancel = false) {
    setPending(true);
    setError("");
    try {
      if (cancel) await api("creator/analysis/" + revision.id, "DELETE");
      else
        await api(
          "creator/drafts/" + revision.draftId + "/transcribe",
          "POST",
          { version: revision.version },
        );
      setResult(
        AnalysisResult.parse(await api("creator/analysis/" + revision.id)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis unavailable.");
    } finally {
      setPending(false);
    }
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
        className={error || job?.state === "failed" ? "sample" : "fine"}
        aria-live="polite"
      >
        {error ||
          job?.error ||
          (active
            ? "You can leave this draft. Analysis is saved and resumes after restart."
            : result?.transcript
              ? "Local transcript ready. Verify against actual footage."
              : "Manual review works without transcription.")}
      </p>
      {stale && (
        <p className="sample">
          Save your private draft to enable transcription for this interval.
          Results belong to the saved source revision.
        </p>
      )}
      {result?.suggestions.map((s, i) => (
        <button
          className="secondary wide"
          key={i}
          disabled={Boolean(stale)}
          onClick={() => onSelect(s.start, s.end, s.evidence, s.messageId)}
        >
          Suggested connection: {s.evidence}
        </button>
      ))}
      {result?.transcript && (
        <div className="transcript">
          <p className="fine">
            {result.transcript.provider} · {result.transcript.model} · sentence
            timing estimates within the saved interval. Verify the final words
            against the recording.
          </p>
          {result.transcript.segments.length === 0 && (
            <p>No speech segments found. Continue with manual review.</p>
          )}
          {result.transcript.segments.map((s, i) => (
            <button
              key={i}
              disabled={Boolean(stale)}
              onClick={() => onSelect(s.start, s.end, s.text)}
            >
              {time(s.start)} · {s.text}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
