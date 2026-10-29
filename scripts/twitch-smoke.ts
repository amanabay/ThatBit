import { z } from "zod";
const port = process.env.PORT ?? "4317";
const base = `http://localhost:${port}`;
const session = z
  .object({ token: z.string() })
  .parse(await fetch(base + "/api/creator/session").then((r) => r.json()));
const state = z
  .object({
    twitch: z.string(),
    messages: z.array(z.object({ source: z.string() })),
  })
  .parse(
    await fetch(base + "/api/creator/state", {
      headers: { "x-creator-token": session.token },
    }).then((r) => r.json()),
  );
console.log(
  JSON.stringify(
    {
      connection: state.twitch,
      intake: state.messages.some((m) => m.source === "twitch")
        ? "PASS: real message stored"
        : "NOT TESTED: send a real ordinary chat message",
      outbound: "NOT TESTED: smoke does not send chat",
    },
    null,
    2,
  ),
);
if (state.twitch !== "Receiving chat") process.exitCode = 1;
