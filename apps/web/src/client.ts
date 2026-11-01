import { z } from "zod";
export let token = "";
let sessionRequest: Promise<string> | undefined;
const Session = z.object({ token: z.string().min(1) });

export function refreshCreatorSession() {
  sessionRequest ??= fetch("/api/creator/session", {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  })
    .then(responseValue)
    .then((value) => {
      const session = Session.parse(value);
      setToken(session.token);
      return session.token;
    })
    .finally(() => {
      sessionRequest = undefined;
    });
  return sessionRequest;
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export class RequestInterrupted extends ApiError {
  constructor(
    readonly uncertain: boolean,
    status = 0,
  ) {
    super(
      uncertain
        ? "The server did not confirm this action. It may have completed. Refresh its status before trying again; the action was not repeated."
        : "The request was interrupted or timed out. Check your connection and try again.",
      status,
    );
  }
}
export async function responseValue(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new ApiError(
      `The server response was interrupted (HTTP ${res.status}). Please try again.`,
      res.status,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError(
      `The server returned ${text.trim() ? "an invalid" : "an empty"} response (HTTP ${res.status}). Reload the page or check that the correct server is running.`,
      res.status,
    );
  }
  if (!res.ok)
    throw new ApiError(
      z.object({ error: z.string() }).safeParse(value).data?.error ??
        `The request failed (HTTP ${res.status}). Please try again.`,
      res.status,
    );
  return value;
}
export async function api(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
) {
  return requestApi(
    path,
    method,
    body === undefined ? undefined : JSON.stringify(body),
    body === undefined ? {} : { "Content-Type": "application/json" },
    signal,
  );
}
export async function apiUpload(
  path: string,
  blob: Blob,
  signal = AbortSignal.timeout(120000),
) {
  return requestApi(
    path,
    "POST",
    blob,
    { "Content-Type": "application/octet-stream" },
    signal,
  );
}
async function requestApi(
  path: string,
  method: string,
  body: BodyInit | undefined,
  headers: Record<string, string>,
  supplied?: AbortSignal,
) {
  const signal =
    supplied ?? AbortSignal.timeout(method === "GET" ? 8000 : 20000);
  const creator = path.startsWith("creator/") && path !== "creator/session";
  let sent = false;
  let status = 0;
  try {
    if (creator && !token) await refreshCreatorSession();
    signal.throwIfAborted();
    const usedToken = token;
    const request = () => {
      sent = true;
      return fetch("/api/" + path, {
        method,
        headers: {
          ...(creator ? { "x-creator-token": token } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body } : {}),
        signal,
      });
    };
    const res = await request();
    status = res.status;
    if (creator && res.status === 401) {
      // Concurrent readers share one renewal. A late old-token rejection can use
      // a token another request already refreshed. Never replay a mutation.
      if (token === usedToken) await refreshCreatorSession();
      signal.throwIfAborted();
      if (method === "GET") return await responseValue(await request());
      throw new ApiError(
        "Studio session refreshed. Your action was not repeated. Review the current revision and try again.",
        401,
      );
    }
    return await responseValue(res);
  } catch (error) {
    if (error instanceof ApiError) {
      if (method !== "GET" && error.status >= 200 && error.status < 300)
        throw new RequestInterrupted(true, error.status);
      throw error;
    }
    if (signal.aborted || error instanceof TypeError)
      throw new RequestInterrupted(sent && method !== "GET", status);
    throw error;
  }
}
export const time = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

export function setToken(value: string) {
  token = value;
}

// Report only fixed event kinds. Browser messages, URLs, stacks and form content
// stay in the browser; reporting failure must never recursively report itself.
export function installClientDiagnostics() {
  let reports = { at: Date.now(), count: 0 };
  const report = (kind: "runtime_error" | "unhandled_rejection") => {
    if (!token) return;
    if (Date.now() - reports.at >= 60000)
      reports = { at: Date.now(), count: 0 };
    if (++reports.count > 10) return;
    void fetch("/api/creator/diagnostics", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-creator-token": token },
      body: JSON.stringify({ kind }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});
  };
  window.addEventListener("error", () => report("runtime_error"));
  window.addEventListener("unhandledrejection", () =>
    report("unhandled_rejection"),
  );
}
