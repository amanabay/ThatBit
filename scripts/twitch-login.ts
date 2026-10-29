import { claimOwner } from "../apps/server/src/adapters/storage/owner.ts";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { Token, saveToken } from "../apps/server/src/adapters/twitch/client.ts";
if (existsSync(".env")) process.loadEnvFile(".env");
const id = process.env.TWITCH_CLIENT_ID;
if (!id)
  throw new Error(
    "Set TWITCH_CLIENT_ID in .env from your registered public Twitch application.",
  );
const root = resolve(process.env.DATA_DIR ?? ".data");
await mkdir(root, { recursive: true, mode: 0o700 });
const release = claimOwner(join(root, "replylink.sqlite"));
try {
  const response = await fetch("https://id.twitch.tv/oauth2/device", {
    method: "POST",
    body: new URLSearchParams({
      client_id: id,
      scopes: "user:read:chat user:write:chat",
    }),
  });
  const device = z
    .object({
      device_code: z.string(),
      user_code: z.string(),
      verification_uri: z.string().url(),
      expires_in: z.number(),
      interval: z.number().default(5),
    })
    .parse(await response.json());
  console.log(
    `Visit ${device.verification_uri} and enter ${device.user_code}. No secrets need to be pasted into chat.`,
  );
  const end = Date.now() + device.expires_in * 1000;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, device.interval * 1000));
    const res = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: id,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    if (res.ok) {
      await saveToken(root, Token.parse(await res.json()));
      console.log("Login saved privately. Restart ReplyLink.");
      break;
    }
    if (res.status !== 400) throw new Error("Device login failed.");
  }
} finally {
  release();
}
