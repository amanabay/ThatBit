import { useEffect, useState } from "react";
import { z } from "zod";
import { api, token } from "../client.ts";
const Result = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      generation: z.number(),
      state: z.string(),
      phase: z.string(),
      outcome: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
});
export function AssistanceActivity() {
  const [data, setData] = useState<z.infer<typeof Result>>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true,
      loading = false;
    const poll = async () => {
      if (loading || !token) return;
      loading = true;
      try {
        const result = Result.parse(
          await api(
            "creator/assistance",
            "GET",
            undefined,
            AbortSignal.timeout(8000),
          ),
        );
        if (alive) {
          setData(result);
          setError("");
        }
      } catch {
        if (alive)
          setError("Assistance activity unavailable. Reconnect the studio.");
      } finally {
        loading = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (!data?.jobs.length && !error) return null;
  return (
    <details className="assistance-activity">
      <summary>Automatic assistance activity</summary>
      <p className="fine" aria-live="polite">
        {error}
      </p>
      {data?.jobs.slice(0, 10).map((j, i) => (
        <div key={j.id}>
          <p>
            Recent recording {i + 1} ·{" "}
            {j.state === "completed"
              ? j.outcome === "suggested"
                ? "Private drafts prepared"
                : "No new confident connection found"
              : j.state === "queued"
                ? j.phase
                : j.state}
          </p>
          {j.error && <p className="sample">{j.error}</p>}
          {["queued", "failed", "cancelled"].includes(j.state) && (
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void api(
                  `creator/assistance/${j.id}/${j.state === "queued" ? "cancel" : "retry"}`,
                  "POST",
                  { generation: j.generation },
                )
                  .then(() => setError(""))
                  .catch(() =>
                    setError(
                      "Analysis changed or the source is unavailable. Refresh before retrying.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {j.state === "queued"
                ? "Cancel pending analysis"
                : "Retry analysis"}
            </button>
          )}
        </div>
      ))}
    </details>
  );
}
