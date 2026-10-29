import { z } from "zod";
export let token = "";
export async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch("/api/" + path, {
    method,
    headers: {
      "x-creator-token": token,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const value: unknown = await res.json();
  if (!res.ok)
    throw new Error(
      z.object({ error: z.string() }).safeParse(value).data?.error ??
        "Operation failed",
    );
  return value;
}
export const time = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

export function setToken(value: string) {
  token = value;
}
