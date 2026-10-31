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
  let validations = 0;
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/oauth2/token")) {
      assert.equal(
        new URLSearchParams(String(init?.body)).get("grant_type"),
        "refresh_token",
      );
      return json(credentials);
    }
    if (url.endsWith("/validate") && ++validations === 1) return json({}, 401);
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
  const packet = (
    type: string,
    payload: unknown,
    timestamp = new Date().toISOString(),
  ) =>
    JSON.stringify({
      metadata: {
        message_id: crypto.randomUUID(),
        message_type: type,
        message_timestamp: timestamp,
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
      "channel.chat.clear",
      "channel.chat.clear_user_messages",
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
          fragments: [
            {
              type: "text",
              text: "Generated protocol fixture, not real audience participation.",
              emote: null,
              cheermote: null,
              mention: null,
              privateExtra: "OMIT_ME",
            },
          ],
        },
      },
    });
    socket.send(chat);
    socket.send(chat);
    const replay = JSON.parse(chat);
    replay.payload.event.message_id = "different-payload-same-envelope";
    socket.send(JSON.stringify(replay));
    await until(() => app.state().messages.length === 1);
    await delay(30);
    assert.equal(
      app.state().messages.length,
      1,
      "envelope ID is deduplicated independently of source message ID",
    );
    const received = app.state().messages[0];
    assert.ok(received?.arrivedAt && received.arrivalSessionId);
    assert.ok((received.arrivedMonotonicMs ?? -1) >= 0);
    assert.equal(
      received.receivedAt,
      JSON.parse(chat).metadata.message_timestamp,
    );
    assert.equal(received.fragments?.[0]?.type, "text");
    assert.ok(!JSON.stringify(received).includes("OMIT_ME"));
    socket.send(
      packet("notification", {
        subscription: { type: "channel.chat.message_delete" },
        event: { message_id: "fixture-original" },
      }),
    );
    await until(() => app.state().messages[0]?.removed === true);
    assert.equal(
      validations,
      2,
      "expired token is refreshed and validated before subscribing",
    );
    const at = new Date(Date.now() + 1000).toISOString();
    socket.send(
      packet(
        "notification",
        {
          subscription: { type: "channel.chat.clear_user_messages" },
          event: {
            broadcaster_user_id: "fixture-owner",
            target_user_id: "cleared-fixture-user",
          },
        },
        at,
      ),
    );
    socket.send(
      packet(
        "notification",
        {
          subscription: { type: "channel.chat.message" },
          event: {
            message_id: "late-cleared",
            chatter_user_id: "cleared-fixture-user",
            chatter_user_name: "ClearedFixture",
            message: { text: "Delayed fixture message from before timeout" },
          },
        },
        new Date(Date.parse(at) - 1).toISOString(),
      ),
    );
    await until(() =>
      app
        .state()
        .messages.some((m) => m.sourceId === "late-cleared" && m.removed),
    );
    socket.send(
      packet(
        "notification",
        {
          subscription: { type: "channel.chat.message" },
          event: {
            message_id: "after-clear",
            chatter_user_id: "cleared-fixture-user",
            chatter_user_name: "ClearedFixture",
            message: { text: "New fixture message after clear" },
          },
        },
        new Date(Date.parse(at) + 1).toISOString(),
      ),
    );
    await until(() =>
      app
        .state()
        .messages.some((m) => m.sourceId === "after-clear" && !m.removed),
    );
    socket.send(
      packet(
        "notification",
        {
          subscription: { type: "channel.chat.clear" },
          event: { broadcaster_user_id: "fixture-owner" },
        },
        new Date(Date.parse(at) + 2).toISOString(),
      ),
    );
    await until(() => app.state().messages.every((m) => m.removed));
    socket.send(
      packet("session_reconnect", {
        session: {
          reconnect_url:
            "wss://eventsub.wss.twitch.tv/ws?fixture=opaque-handoff",
        },
      }),
    );
    await until(
      () =>
        [...ws.clients].some((s) => s !== socket) &&
        twitch.status === "Receiving chat",
    );
    assert.equal(
      subscriptions.length,
      4,
      "successful handoff retains subscriptions",
    );
    const successor = [...ws.clients].find((s) => s !== socket);
    assert.ok(successor);
    successor.send(
      packet("revocation", { subscription: { type: "channel.chat.message" } }),
    );
    await until(() => twitch.status === "Subscription revoked — needs login");
    await delay(1100);
    assert.equal(
      ws.clients.size,
      0,
      "revocation closes sockets without reconnecting",
    );
    assert.ok(!requests.some((url) => url.endsWith("/chat/messages")));
  } finally {
    twitch.stop();
    for (const socket of ws.clients) socket.terminate();
    await new Promise<void>((resolve) => ws.close(() => resolve()));
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Twitch protocol recovery handles subscription throttling, failed handoff, duplicate replay and malformed frames without outbound chat", async () => {
  const root = await mkdtemp(join(tmpdir(), "replylink-twitch-faults-"));
  const store = new SQLiteStore(join(root, "db"));
  const app = new Exchanges(
    store,
    new FFmpegMedia(join(root, "media")),
    "fixture",
  );
  const ws = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => ws.once("listening", resolve));
  const address = ws.address();
  assert.ok(address && typeof address !== "string");
  let connections = 0,
    subscriptions = 0,
    throttled = false;
  const urls: string[] = [];
  const packet = (type: string, payload: unknown) =>
    JSON.stringify({
      metadata: {
        message_id: crypto.randomUUID(),
        message_type: type,
        message_timestamp: new Date().toISOString(),
      },
      payload,
    });
  ws.on("connection", (socket) => {
    connections++;
    if (connections === 3) {
      socket.close();
      return;
    } // Failed reconnect handoff.
    socket.send(
      packet("session_welcome", {
        session: {
          id: "fixture-session-" + connections,
          keepalive_timeout_seconds: 10,
        },
      }),
    );
  });
  const request: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/validate"))
      return json({
        client_id: "fixture-client",
        user_id: "fixture-owner",
        scopes: [READ_SCOPE],
        expires_in: 3600,
      });
    if (url.includes("/users?"))
      return json({ data: [{ id: "fixture-owner" }] });
    assert.ok(
      url.endsWith("/eventsub/subscriptions"),
      "only intake subscription requests are authorized by this fixture",
    );
    subscriptions++;
    if (!throttled && subscriptions === 2) {
      throttled = true;
      return json({}, 429);
    }
    return json({ data: [] }, 202);
  };
  const twitch = new Twitch(
    app,
    root,
    "fixture-client",
    "fixture_channel",
    request,
    (url) => {
      urls.push(url);
      return new WebSocket(`ws://127.0.0.1:${address.port}`);
    },
  );
  async function until(condition: () => boolean) {
    const deadline = Date.now() + 5000;
    while (!condition() && Date.now() < deadline) await delay(10);
    assert.ok(condition(), twitch.status);
  }
  const current = () => {
    const socket = [...ws.clients].find((s) => s.readyState === 1);
    assert.ok(socket);
    return socket;
  };
  try {
    await saveToken(root, credentials);
    await twitch.start();
    await until(() => connections === 2 && twitch.status === "Receiving chat");
    assert.equal(
      subscriptions,
      6,
      "failed session is replaced and all four subscriptions recreated",
    );
    const chat = packet("notification", {
      subscription: { type: "channel.chat.message" },
      event: {
        message_id: "fixture-original",
        chatter_user_id: "fixture-viewer",
        chatter_user_name: "Fixture",
        message: {
          text: "Kappa fixture cheer100 @Fixture",
          fragments: [
            {
              type: "emote",
              text: "Kappa",
              emote: {
                id: "25",
                emote_set_id: "0",
                owner_id: "fixture-owner",
                format: ["static"],
              },
            },
            { type: "text", text: " fixture " },
            {
              type: "cheermote",
              text: "cheer100",
              cheermote: { prefix: "cheer", bits: 100, tier: 100 },
            },
            {
              type: "mention",
              text: "@Fixture",
              mention: {
                user_id: "fixture-owner",
                user_name: "Fixture",
                user_login: "fixture",
              },
            },
          ],
        },
      },
    });
    current().send(chat);
    await until(() => app.state().messages.length === 1);
    assert.equal(app.state().messages[0]?.fragments?.[0]?.emote?.id, "25");
    assert.equal(app.state().messages[0]?.fragments?.[2]?.cheermote?.bits, 100);
    current().send(
      packet("session_reconnect", {
        session: {
          reconnect_url:
            "wss://eventsub.wss.twitch.tv/ws?fixture=failed-handoff",
        },
      }),
    );
    await until(() => connections >= 4 && twitch.status === "Receiving chat");
    assert.equal(
      subscriptions,
      10,
      "failed handoff falls back to a new subscribed session",
    );
    const replay = JSON.parse(chat);
    replay.payload.event.message_id = "replayed-different-source";
    current().send(JSON.stringify(replay));
    await delay(40);
    assert.equal(app.state().messages.length, 1);
    current().send("{malformed fixture");
    await until(() => connections >= 5 && twitch.status === "Receiving chat");
    assert.equal(
      app.state().messages.length,
      1,
      "a gap invents no audience messages",
    );
    const before = urls.length;
    current().send(
      packet("session_reconnect", {
        session: { reconnect_url: "wss://evil.example/fixture" },
      }),
    );
    await until(
      () => urls.length > before && twitch.status === "Receiving chat",
    );
    assert.ok(
      urls.every((url) => new URL(url).hostname === "eventsub.wss.twitch.tv"),
    );
  } finally {
    twitch.stop();
    for (const socket of ws.clients) socket.terminate();
    await new Promise<void>((resolve) => ws.close(() => resolve()));
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
