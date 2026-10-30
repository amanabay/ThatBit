import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer } from "ws";
import {
  beginDeviceLogin,
  finishDeviceLogin,
  verifyLogin,
  READ_SCOPE,
  WRITE_SCOPE,
  TwitchLoginError,
  type DeviceLogin,
} from "../apps/server/src/adapters/twitch/auth.ts";
import {
  Twitch,
  saveToken,
} from "../apps/server/src/adapters/twitch/client.ts";
import { Exchanges } from "../apps/server/src/application/exchanges.ts";
import { SQLiteStore } from "../apps/server/src/adapters/storage/sqlite.ts";
import { FFmpegMedia } from "../apps/server/src/adapters/media/ffmpeg.ts";
const fixtureDevice = {
  device_code: "fixture-device-secret",
  user_code: "FIXTURE",
  verification_uri: "https://www.twitch.tv/activate?public=true",
  expires_in: 120,
  interval: 5,
};
const credentials = {
  access_token: "fixture-access-not-real",
  refresh_token: "fixture-refresh-not-real",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
test("Twitch device login polls the requested scopes, respects pending/slow-down and defaults to read-only", async () => {
  let now = 0;
  const scopes: string[] = [];
  const begin: typeof fetch = async (_input, init) => {
    scopes.push(new URLSearchParams(String(init?.body)).get("scopes") ?? "");
    return json(fixtureDevice);
  };
  const device = await beginDeviceLogin(
    "fixture-client",
    false,
    begin,
    () => now,
  );
  assert.equal(scopes[0], READ_SCOPE);
  await beginDeviceLogin("fixture-client", true, begin);
  assert.equal(scopes[1], `${READ_SCOPE} ${WRITE_SCOPE}`);
  const sleeps: number[] = [];
  let polls = 0;
  const token = await finishDeviceLogin("fixture-client", device, {
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    request: async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("scopes"), READ_SCOPE);
      assert.equal(
        body.get("grant_type"),
        "urn:ietf:params:oauth:grant-type:device_code",
      );
      assert.equal(body.get("device_code"), fixtureDevice.device_code);
      polls++;
      return polls === 1
        ? json({ message: "authorization_pending" }, 400)
        : polls === 2
          ? json({ message: "slow_down" }, 400)
          : json(credentials);
    },
  });
  assert.deepEqual(token, credentials);
  assert.deepEqual(sleeps, [5000, 5000, 10000]);
});
test("Twitch login terminates denial/expiry/rejection and refuses unexpected activation hosts", async () => {
  const device: DeviceLogin = {
    ...fixtureDevice,
    scopes: READ_SCOPE,
    expiresAt: 10000,
  };
  for (const [message, expected] of [
    ["access_denied", "TWITCH_LOGIN_DENIED"],
    ["expired_token", "TWITCH_LOGIN_EXPIRED"],
    ["invalid device code", "TWITCH_LOGIN_EXPIRED"],
    ["PRIVATE_UNKNOWN_RESPONSE", "TWITCH_LOGIN_REJECTED"],
  ]) {
    let now = 0,
      calls = 0;
    await assert.rejects(
      () =>
        finishDeviceLogin("fixture", device, {
          now: () => now,
          sleep: async (ms) => {
            now += ms;
          },
          request: async () => {
            calls++;
            return json({ message }, 400);
          },
        }),
      (error) =>
        error instanceof TwitchLoginError &&
        error.code === expected &&
        !error.message.includes("PRIVATE_"),
    );
    assert.equal(calls, 1);
  }
  let now = 0;
  await assert.rejects(
    () =>
      finishDeviceLogin(
        "fixture",
        { ...device, expiresAt: 1000 },
        {
          now: () => now,
          sleep: async (ms) => {
            now += ms;
          },
          request: async () => {
            throw Error("Must expire before polling");
          },
        },
      ),
    (error: unknown) =>
      error instanceof TwitchLoginError &&
      error.code === "TWITCH_LOGIN_EXPIRED",
  );
  await assert.rejects(
    () =>
      beginDeviceLogin("fixture", false, async () =>
        json({
          ...fixtureDevice,
          verification_uri: "https://evil.example/activate",
        }),
      ),
    /unexpected activation/,
  );
  await assert.rejects(
    () =>
      beginDeviceLogin("fixture", false, async () =>
        json({ message: "PRIVATE_PROVIDER_ERROR" }, 400),
      ),
    /Client Type is Public/,
  );
});
test("Twitch login verifies app, permission and channel ownership before allowing credentials to be saved", async () => {
  const identity = {
    client_id: "fixture-client",
    user_id: "fixture-owner",
    scopes: [READ_SCOPE],
  };
  const request: typeof fetch = async (input) =>
    String(input).includes("/validate")
      ? json(identity)
      : json({ data: [{ id: "fixture-owner" }] });
  await verifyLogin(
    credentials,
    "fixture-client",
    "fixture_channel",
    READ_SCOPE,
    request,
  );
  await assert.rejects(
    () =>
      verifyLogin(
        credentials,
        "another-client",
        "fixture_channel",
        READ_SCOPE,
        request,
      ),
    /does not match/,
  );
  await assert.rejects(
    () =>
      verifyLogin(
        credentials,
        "fixture-client",
        "fixture_channel",
        WRITE_SCOPE,
        request,
      ),
    /does not match/,
  );
  await assert.rejects(
    () =>
      verifyLogin(
        credentials,
        "fixture-client",
        "another_channel",
        READ_SCOPE,
        async (input) =>
          String(input).includes("/validate")
            ? json(identity)
            : json({ data: [{ id: "another-owner" }] }),
      ),
    /owns TWITCH_CHANNEL/,
  );
});
test("Twitch read-only intake handles welcome, duplicate chat and deletion through an actual WebSocket protocol fixture", async () => {
  const root = await mkdtemp(join(tmpdir(), "replylink-twitch-"));
  const store = new SQLiteStore(join(root, "replylink.sqlite"));
  const app = new Exchanges(
    store,
    new FFmpegMedia(join(root, "media")),
    "fixture",
  );
  const ws = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => ws.once("listening", resolve));
  const address = ws.address();
  assert.ok(address && typeof address !== "string");
  const requests: string[] = [],
    subscriptions: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/validate"))
      return json({
        client_id: "fixture-client",
        user_id: "fixture-owner",
        scopes: [READ_SCOPE],
        expires_in: 3600,
      });
    if (url.includes("/users?"))
      return json({ data: [{ id: "fixture-owner" }] });
    assert.ok(url.endsWith("/eventsub/subscriptions"));
    const body = JSON.parse(String(init?.body));
    subscriptions.push(body.type);
    assert.equal(body.condition.user_id, "fixture-owner");
    return json({ data: [] }, 202);
  };
  const twitch = new Twitch(
    app,
    root,
    "fixture-client",
    "fixture_channel",
    request,
    () => new WebSocket(`ws://127.0.0.1:${address.port}`),
  );
  const packet = (type: string, payload: unknown) =>
    JSON.stringify({
      metadata: {
        message_id: "fixture-envelope",
        message_type: type,
        message_timestamp: new Date().toISOString(),
      },
      payload,
    });
  ws.on("connection", (socket) =>
    socket.send(
      packet("session_welcome", {
        session: { id: "fixture-session", keepalive_timeout_seconds: 10 },
      }),
    ),
  );
  const until = async (condition: () => boolean) => {
    const end = Date.now() + 3000;
    while (!condition() && Date.now() < end) await delay(10);
    assert.ok(condition(), twitch.status);
  };
  try {
    await saveToken(root, credentials);
    assert.equal(
      (await stat(join(root, "twitch-token.json"))).mode & 0o777,
      0o600,
    );
    await twitch.start();
    await until(() => twitch.status === "Receiving chat");
    assert.deepEqual(subscriptions, [
      "channel.chat.message",
      "channel.chat.message_delete",
    ]);
    const socket = [...ws.clients][0];
    assert.ok(socket);
    const chat = packet("notification", {
      subscription: { type: "channel.chat.message" },
      event: {
        message_id: "fixture-original",
        chatter_user_id: "fixture-viewer",
        chatter_user_name: "ProtocolFixture",
        message: {
          text: "Generated protocol fixture, not real audience participation.",
        },
      },
    });
    socket.send(chat);
    socket.send(chat);
    await until(() => app.state().messages.length === 1);
    socket.send(
      packet("notification", {
        subscription: { type: "channel.chat.message_delete" },
        event: { message_id: "fixture-original" },
      }),
    );
    await until(() => app.state().messages[0]?.removed === true);
    assert.ok(!requests.some((url) => url.endsWith("/chat/messages")));
  } finally {
    twitch.stop();
    for (const socket of ws.clients) socket.terminate();
    await new Promise<void>((resolve) => ws.close(() => resolve()));
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
