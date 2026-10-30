import { z } from "zod";
export let token = "";
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
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
export async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch("/api/" + path, {
    method,
    headers: {
      "x-creator-token": token,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return responseValue(res);
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
    }).catch(() => {});
  };
  window.addEventListener("error", () => report("runtime_error"));
  window.addEventListener("unhandledrejection", () =>
    report("unhandled_rejection"),
  );
}
