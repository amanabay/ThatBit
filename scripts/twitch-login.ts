import { creatorDatabase } from "../apps/server/src/adapters/storage/collection.ts";
import { claimOwner } from "../apps/server/src/adapters/storage/owner.ts";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { saveToken } from "../apps/server/src/adapters/twitch/client.ts";
import {
  beginDeviceLogin,
  finishDeviceLogin,
  verifyLogin,
  TwitchLoginError,
} from "../apps/server/src/adapters/twitch/auth.ts";
let release: (() => void) | undefined;
try {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const id = process.env.TWITCH_CLIENT_ID?.trim();
  const channel = process.env.TWITCH_CHANNEL?.trim();
  if (!id)
    throw new TwitchLoginError(
      "TWITCH_CONFIG_REQUIRED",
      "Set TWITCH_CLIENT_ID in local .env from your registered public Twitch application.",
    );
  if (!channel || !/^[a-zA-Z0-9_]{1,25}$/.test(channel))
    throw new TwitchLoginError(
      "TWITCH_CHANNEL_REQUIRED",
      "Set TWITCH_CHANNEL in local .env to your own channel login, without @ or a Twitch URL.",
    );
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--with-sharing"))
    throw new TwitchLoginError(
      "TWITCH_LOGIN_ARGUMENT",
      "Use npm run twitch:login, or add -- --with-sharing only when enabling the separate sharing feature.",
    );
  const root = resolve(process.env.DATA_DIR ?? ".data");
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    release = claimOwner(creatorDatabase(root));
  } catch {
    throw new TwitchLoginError(
      "TWITCH_COLLECTION_BUSY",
      "Stop ThatBit with Ctrl+C before running twitch:login, then restart it after login completes.",
    );
  }
  const device = await beginDeviceLogin(id, args.includes("--with-sharing"));
  console.log(
    `Open ${device.verification_uri}\nEnter code ${device.user_code} if asked. Sign in as the owner of TWITCH_CHANNEL.\nWaiting up to ${Math.ceil(device.expires_in / 60)} minutes. Press Ctrl+C to cancel.\nRequested permission: ${args.includes("--with-sharing") ? "read chat and separately authorized sharing" : "read chat only"}. Tokens stay local.`,
  );
  const token = await finishDeviceLogin(id, device);
  await verifyLogin(token, id, channel, device.scopes);
  await saveToken(root, token);
  console.log(
    "Twitch login validated and saved privately. Restart with npm run dev:local, then send a message yourself in your channel chat to verify intake.",
  );
} catch (error) {
  console.error(
    error instanceof TwitchLoginError
      ? `${error.code}: ${error.message}`
      : "TWITCH_LOGIN_FAILED: Check your connection, local file permissions and Twitch configuration, then retry. Credentials were not printed.",
  );
  process.exitCode = 1;
} finally {
  release?.();
}
