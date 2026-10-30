import { parseCaptions } from "./captions.ts";
export function CaptionEditor({
  text,
  duration,
  onChange,
  onPreview,
}: {
  text: string;
  duration: number;
  onChange: (text: string) => void;
  onPreview: (start: number) => void;
}) {
  const result = parseCaptions(text, duration);
  const rows = result.rows;
  function update(
    index: number,
    field: "start" | "end" | "text",
    value: string,
  ) {
    onChange(
      rows
        .map((row, i) => {
          const r =
            i === index
              ? {
                  ...row,
                  [field]:
                    field === "text" ? value.replace(/\r?\n/g, " ") : value,
                }
              : row;
          return `${r.start} | ${r.end} | ${r.text}`;
        })
        .join("\n"),
    );
  }
  return (
    <section className="caption-editor" aria-label="Caption editor">
      <div className="caption-heading">
        <div>
          <h2>Captions</h2>
          <p className="fine">
            Times are relative to this reply. Listen and correct the words
            before saving.
          </p>
        </div>
        <span className="badge">{rows.length} captions</span>
      </div>
      {rows.length === 0 && (
        <p className="fine">
          Use your transcript or add a caption to get started.
        </p>
      )}
      <div className="caption-rows">
        {rows.map((row, i) => (
          <div className="caption-row" key={i}>
            <div className="caption-row-times">
              <span className="caption-index" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <label>
                Start
                <input
                  aria-label={`Caption ${i + 1} start`}
                  inputMode="decimal"
                  value={row.start}
                  onChange={(e) => update(i, "start", e.target.value)}
                />
              </label>
              <label>
                End
                <input
                  aria-label={`Caption ${i + 1} end`}
                  inputMode="decimal"
                  value={row.end}
                  onChange={(e) => update(i, "end", e.target.value)}
                />
              </label>
            </div>
            <label className="caption-words">
              <span className="sr-only">Caption {i + 1} text</span>
              <textarea
                aria-label={`Caption ${i + 1} text`}
                rows={2}
                maxLength={500}
                value={row.text}
                onChange={(e) => update(i, "text", e.target.value)}
              />
            </label>
            <div className="caption-row-actions">
              <button
                disabled={
                  !Number.isFinite(Number(row.start)) ||
                  !row.start ||
                  Number(row.start) < 0 ||
                  Number(row.start) >= duration
                }
                onClick={() => onPreview(Number(row.start))}
              >
                Play from caption {i + 1}
              </button>
              <button
                className="danger"
                aria-label={`Remove caption ${i + 1}`}
                onClick={() =>
                  onChange(
                    rows
                      .filter((_, j) => j !== i)
                      .map((r) => `${r.start} | ${r.end} | ${r.text}`)
                      .join("\n"),
                  )
                }
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        className="secondary"
        disabled={rows.length >= 300}
        onClick={() => {
          const last = rows.at(-1);
          const start =
            last?.end && Number.isFinite(Number(last.end))
              ? Number(last.end)
              : 0;
          onChange(
            [
              ...rows.map((r) => `${r.start} | ${r.end} | ${r.text}`),
              `${start} | ${Math.min(start + 3, Math.max(duration, 0))} | `,
            ].join("\n"),
          );
        }}
      >
        + Add caption
      </button>
      {result.errors.length > 0 && (
        <p className="sample" role="alert">
          {result.errors[0]}
        </p>
      )}
      <details className="caption-advanced">
        <summary>Advanced caption text</summary>
        <label className="field">
          Captions (relative start | end | text, one per line)
          <textarea
            value={text}
            aria-invalid={!result.valid}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0 | 2.5 | Your corrected caption"
          />
        </label>
      </details>
    </section>
  );
}
