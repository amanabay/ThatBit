import { z } from "zod";
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
const port = process.env.PORT ?? "4317";
const base = `http://localhost:${port}`;
try {
  const sessionResponse = await fetch(base + "/api/creator/session", {
    signal: AbortSignal.timeout(10000),
  });
  if (!sessionResponse.ok) throw new Error("Creator session unavailable");
  const session = z
    .object({ token: z.string() })
    .parse(await sessionResponse.json());
  const response = await fetch(base + "/api/creator/state", {
    headers: { "x-creator-token": session.token },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Creator state unavailable");
  const state = z
    .object({
      twitch: z.string(),
      messages: z.array(z.object({ source: z.string() })),
    })
    .parse(await response.json());
  console.log(
    JSON.stringify(
      {
        connection: state.twitch,
        intake: state.messages.some((m) => m.source === "twitch")
          ? "OBSERVED: Twitch source messages stored; verify a fresh message in the studio"
          : "NOT TESTED: send a real ordinary chat message",
        outbound: "NOT TESTED: smoke does not send chat",
      },
      null,
      2,
    ),
  );
  if (state.twitch !== "Receiving chat") process.exitCode = 1;
} catch {
  console.error(
    "TWITCH_SMOKE_FAILED: Start ReplyLink on the configured PORT and retry. No chat or credentials were printed.",
  );
  process.exitCode = 1;
}
