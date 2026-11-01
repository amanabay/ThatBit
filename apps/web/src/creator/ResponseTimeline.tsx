import { useEffect, useState, type RefObject } from "react";
import { Waveform } from "../../../../shared/contracts/capture.ts";
import { api, time } from "../client.ts";
export function ResponseTimeline({
  assetId,
  start,
  end,
  duration,
  player,
  onChange,
}: {
  assetId: string;
  start: number;
  end: number;
  duration: number;
  player: RefObject<HTMLVideoElement | null>;
  onChange: (value: { start: number; end: number }) => void;
}) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [waveStatus, setWaveStatus] = useState("Loading audio overview…");
  useEffect(() => {
    let alive = true;
    setPeaks([]);
    setZoom(undefined);
    setWaveStatus("Loading audio overview…");
    void api("creator/media/" + assetId + "/waveform")
      .then((v) => {
        const result = Waveform.parse(v);
        if (alive) {
          setPeaks(result.peaks);
          setWaveStatus(
            result.status === "no-audio"
              ? "No recorded audio"
              : result.status === "silent"
                ? "Silent recorded audio"
                : "Audio signal overview; verify speech in playback",
          );
        }
      })
      .catch(() => {
        if (alive)
          setWaveStatus(
            "Audio overview unavailable; numeric controls remain available.",
          );
      });
    return () => {
      alive = false;
    };
  }, [assetId]);
  const [zoom, setZoom] = useState<{ from: number; to: number }>();
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const from = zoom?.from ?? 0,
    to = zoom?.to ?? duration;
  return (
    <section
      className="response-timeline"
      aria-label="Response timeline"
      tabIndex={0}
      onKeyDown={(event) => {
        if (
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement ||
          event.target instanceof HTMLButtonElement ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        const video = player.current;
        if (!video) return;
        const key = event.key.toLowerCase();
        if (key === " ") {
          event.preventDefault();
          if (video.paused)
            void video
              .play()
              .catch(() =>
                setWaveStatus(
                  "Playback could not start. Use the video controls to preview the recording.",
                ),
              );
          else video.pause();
        } else if (key === "j" || key === "l") {
          event.preventDefault();
          video.currentTime = Math.min(
            duration,
            Math.max(
              0,
              video.currentTime +
                (key === "j" ? -1 : 1) * (event.shiftKey ? 0.1 : 1),
            ),
          );
        } else if (key === "i" && video.currentTime < end)
          onChange({ start: video.currentTime, end });
        else if (key === "o" && video.currentTime > start)
          onChange({ start, end: video.currentTime });
      }}
    >
      <div className="section-heading">
        <h2>Response timeline</h2>
        <button
          className="subtle"
          onClick={() =>
            setZoom(
              zoom
                ? undefined
                : {
                    from: Math.max(0, start - 5),
                    to: Math.min(duration, end + 5),
                  },
            )
          }
        >
          {zoom ? "Show full recording" : "Zoom to selection"}
        </button>
      </div>
      <p className="fine">{waveStatus}</p>
      {peaks.length > 1 && (
        <svg
          className="waveform"
          viewBox={`${(from / duration) * 2048} 0 ${((to - from) / duration) * 2048} 80`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Recorded audio signal overview"
        >
          <path
            d={peaks
              .map(
                (p, i) =>
                  `M${(i / peaks.length) * 2048} ${40 - p * 38}v${p * 76}`,
              )
              .join(" ")}
          />
        </svg>
      )}
      <div className="timeline-track">
        <div
          style={{
            left: Math.max(0, ((start - from) / (to - from)) * 100) + "%",
            width: Math.min(100, ((end - start) / (to - from)) * 100) + "%",
          }}
        />
      </div>
      <label>
        Timeline start
        <input
          aria-label="Timeline start"
          type="range"
          min={from}
          max={to}
          step="0.01"
          value={start}
          onChange={(e) =>
            onChange({
              start: Math.max(0, Math.min(Number(e.target.value), end - 0.01)),
              end,
            })
          }
        />
      </label>
      <label>
        Timeline end
        <input
          aria-label="Timeline end"
          type="range"
          min={from}
          max={to}
          step="0.01"
          value={end}
          onChange={(e) =>
            onChange({
              start,
              end: Math.min(
                duration,
                Math.max(Number(e.target.value), start + 0.01),
              ),
            })
          }
        />
      </label>
      <p className="fine">
        {time(start)} → {time(end)} · Focus this panel: Space plays/pauses, I/O
        set boundaries, J/L seek 1 second, Shift+J/L seek 0.1 second. Numeric
        fields remain available.
      </p>
    </section>
  );
}
