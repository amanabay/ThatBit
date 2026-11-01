import { useEffect, useRef, useState } from "react";
import { PublicReply } from "../../../../shared/contracts/models.ts";
import { ApiError, responseValue } from "../client.ts";

export function usePublicReplay(id: string) {
  const [reply, setReply] = useState<PublicReply>();
  const [error, setError] = useState<"unavailable" | "failed">();
  const refresh = useRef<() => Promise<boolean | undefined>>(
    async () => undefined,
  );
  useEffect(() => {
    let alive = true;
    let removed = false;
    let pending: Promise<boolean | undefined> | undefined;
    let controller: AbortController | undefined;
    setReply(undefined);
    setError(undefined);
    const check = () => {
      if (!alive || removed) return Promise.resolve(false);
      if (pending) return pending;
      controller = new AbortController();
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(8000),
      ]);
      pending = fetch("/api/public/replies/" + encodeURIComponent(id), {
        cache: "no-store",
        signal,
      })
        .then(responseValue)
        .then((value) => {
          const approved = PublicReply.parse(value);
          if (!alive) return false;
          setReply(approved);
          setError(undefined);
          return true;
        })
        .catch((failure: unknown) => {
          if (!alive) return false;
          if (
            failure instanceof ApiError &&
            [404, 410].includes(failure.status)
          ) {
            removed = true;
            setReply(undefined);
            setError("unavailable");
            return false;
          } else setError("failed");
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    };
    refresh.current = check;
    const checkVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    const timer = window.setInterval(checkVisible, 15000);
    window.addEventListener("focus", checkVisible);
    document.addEventListener("visibilitychange", checkVisible);
    return () => {
      alive = false;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", checkVisible);
      document.removeEventListener("visibilitychange", checkVisible);
    };
  }, [id]);
  return { reply, error, refresh: () => refresh.current() };
}
