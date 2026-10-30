import { useState } from "react";
import {
  ObsInspection,
  type StudioState,
} from "../../../../shared/contracts/studio.ts";
import { api, time } from "../client.ts";
import type { z } from "zod";
const phases = {
  unconfigured: "OBS needs setup",
  connecting: "Connecting to OBS",
  stopped: "OBS recording stopped",
  warming: "OBS recording is warming up",
  recording: "OBS recording active",
  paused: "OBS recording paused",
  disconnected: "OBS disconnected",
  error: "OBS needs attention",
};
export function CaptureReadiness({
  data,
  offline,
  browserRecording,
}: {
  data: StudioState;
  offline: boolean;
  browserRecording: boolean;
}) {
  const [report, setReport] = useState<z.infer<typeof ObsInspection>>();
  const [checkedAt, setCheckedAt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const health = data.obsHealth;
  const closed = data.obsSegments.filter((s) =>
    data.assets.some((a) => a.id === s.id),
  );
  const seconds = closed.reduce(
    (n, s) => n + (data.assets.find((a) => a.id === s.id)?.duration ?? 0),
    0,
  );
  async function inspect() {
    setBusy(true);
    setError("");
    setReport(undefined);
    try {
      setReport(ObsInspection.parse(await api("creator/obs/inspect")));
      setCheckedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "OBS check unavailable.");
    } finally {
      setBusy(false);
    }
  }
  const allMuted =
    report &&
    report.audioInputs.length > 0 &&
    report.audioInputs.every(
      (a) => a.muted || a.volumeMul === 0 || a.enabledTracks.length === 0,
    );
  return (
    <section className="capture-readiness" aria-label="Capture readiness">
      <details>
        <summary>
          <span>
            {offline
              ? "Capture status unavailable · studio offline"
              : health
                ? phases[health.phase]
                : data.obs}
          </span>
          <span>
            {closed.length} closed segments · {time(seconds)} saved
          </span>
        </summary>
        <div className="readiness-grid">
          <div>
            <h3>OBS recording</h3>
            <p>
              {offline
                ? "These are the last received values. Reconnect before relying on capture status."
                : data.obs}
            </p>
            <p className="fine">
              Start recording in OBS. Allow about 60 seconds for the first
              usable closed footage. An open preview or connected WebSocket does
              not prove audible audio.
            </p>
            <p className="fine">
              {health
                ? `Recorded audio stream ${health.audioTrack} · ${health.queueDepth} importing`
                : "Original OBS files remain untouched."}{" "}
              {health?.lastSegmentAt
                ? `Last segment saved ${new Date(health.lastSegmentAt).toLocaleTimeString()}.`
                : ""}
            </p>
            <button
              className="secondary"
              disabled={busy || offline}
              onClick={() => void inspect()}
            >
              {busy ? "Checking OBS…" : "Check OBS audio & routing"}
            </button>
          </div>
          <div>
            <h3>Browser capture</h3>
            <p>
              {browserRecording
                ? "Recording the source and audio you shared in this tab."
                : "Use Choose screen or tab in Sources & setup to start browser capture."}
            </p>
            <p className="fine">
              Separate from OBS. Linux window sharing can omit audio. No extra
              microphone is added.
            </p>
          </div>
        </div>
        <div aria-live="polite">
          {error && <p className="sample">{error}</p>}
          {report && (
            <div className="audio-inspection">
              <h3>OBS audio check · {checkedAt}</h3>
              <p
                className={
                  allMuted || !report.audioInputs.length ? "sample" : "fine"
                }
              >
                {allMuted
                  ? "All audio inputs are muted, at zero gain, or routed to no tracks. Unmute the intended source in OBS and record a new audible test."
                  : !report.audioInputs.length
                    ? "No audio-capable inputs found. Add the intended source in OBS."
                    : "Check the intended input below, then speak and verify its meter in OBS."}
              </p>
              {report.audioInputs.map((a, i) => (
                <p key={i}>
                  Input {i + 1} · {a.kind} ·{" "}
                  <b>
                    {a.muted
                      ? "Muted"
                      : a.volumeMul === 0
                        ? "Zero gain"
                        : "Unmuted"}
                  </b>{" "}
                  · mixer tracks {a.enabledTracks.join(", ") || "none"}
                </p>
              ))}
              <p className="fine">
                Read-only snapshot; settings can change after this check.
                Routing is not proof of an active device, scene or audible
                speech. Mixer checkbox numbers can differ from recorded stream
                positions. Play a saved clip to verify sound and
                synchronization.
              </p>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
