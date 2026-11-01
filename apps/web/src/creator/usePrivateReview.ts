import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../client.ts";
export type PendingReview = (id: string, pending: boolean) => void;
// Both private assessment forms need the same save/edit and navigation guarantees.
export function usePrivateReview<T>({
  id,
  path,
  initial,
  read,
  validate,
  saved,
  onPending,
}: {
  id: string;
  path: string;
  initial: T;
  read: (value: unknown) => T | null;
  validate: (value: T) => T;
  saved: string;
  onPending: PendingReview;
}) {
  const [input, setInput] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const value = useRef(initial),
    original = useRef(initial);
  const edits = useRef(0),
    reads = useRef(0);
  const active = useRef(false),
    saving = useRef(false);
  const report = useRef(onPending);
  report.current = onPending;
  const changed = JSON.stringify(input) !== JSON.stringify(baseline);
  const reload = useCallback(async () => {
    const sequence = ++reads.current,
      version = edits.current;
    const untouched =
      JSON.stringify(value.current) === JSON.stringify(original.current);
    setLoading(true);
    try {
      const stored = read(await api(path));
      if (!active.current || sequence !== reads.current) return;
      const next = stored ?? initial;
      original.current = next;
      setBaseline(next);
      setReady(true);
      if (version === edits.current && untouched) {
        value.current = next;
        setInput(next);
        setStatus(stored ? saved : "");
      } else
        setStatus("Saved review loaded. Your local edits remain in this form.");
    } catch (error) {
      if (active.current && sequence === reads.current)
        setStatus(
          error instanceof Error
            ? error.message
            : "Saved review unavailable. Reload before saving changes.",
        );
    } finally {
      if (active.current && sequence === reads.current) setLoading(false);
    }
  }, [path, read, initial, saved]);
  useEffect(() => {
    active.current = true;
    void reload();
    return () => {
      active.current = false;
      reads.current++;
      report.current(id, false);
    };
  }, [id, reload]);
  useEffect(() => {
    report.current(id, changed || busy);
  }, [id, changed, busy]);
  function update(change: Partial<T>) {
    edits.current++;
    value.current = { ...value.current, ...change };
    setInput(value.current);
    setStatus("Unsaved private review changes.");
    report.current(id, true);
  }
  async function save() {
    if (!ready || saving.current) return;
    saving.current = true;
    setBusy(true);
    report.current(id, true);
    const version = edits.current,
      submitted = value.current;
    try {
      await api(path, "POST", validate(submitted));
      if (!active.current) return;
      original.current = submitted;
      setBaseline(submitted);
      setStatus(
        version === edits.current
          ? saved
          : "Earlier review saved. Your newer changes still need saving.",
      );
    } catch (error) {
      if (active.current)
        setStatus(
          error instanceof Error
            ? error.message
            : "Private review could not be saved.",
        );
    } finally {
      saving.current = false;
      if (active.current) {
        setBusy(false);
        report.current(
          id,
          JSON.stringify(value.current) !== JSON.stringify(original.current),
        );
      }
    }
  }
  function discard() {
    if (saving.current) return;
    edits.current++;
    value.current = original.current;
    setInput(original.current);
    setStatus("Unsaved private review changes discarded.");
    report.current(id, false);
  }
  return {
    input,
    changed,
    ready,
    loading,
    busy,
    status,
    update,
    save,
    discard,
    reload,
  };
}
