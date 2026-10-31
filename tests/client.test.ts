import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  responseValue,
  api,
  setToken,
} from "../apps/web/src/client.ts";
test("API responses handle empty success, empty failures and malformed bodies without exposing JSON errors or response contents", async () => {
  assert.equal(
    await responseValue(new Response(null, { status: 204 })),
    undefined,
  );
  assert.deepEqual(await responseValue(Response.json({ ok: true })), {
    ok: true,
  });
  for (const [status, body] of [
    [404, ""],
    [200, " "],
    [200, "{PRIVATE_INCOMPLETE"],
    [502, "<html>PRIVATE_PROXY_CONTENT</html>"],
  ] as const) {
    await assert.rejects(
      () => responseValue(new Response(body, { status })),
      (error) =>
        error instanceof ApiError &&
        error.status === status &&
        !error.message.includes("PRIVATE_") &&
        !error.message.includes("JSON") &&
        error.message.includes(`HTTP ${status}`),
    );
  }
  await assert.rejects(
    () =>
      responseValue(
        Response.json({ error: "Source unavailable." }, { status: 410 }),
      ),
    (error) =>
      error instanceof ApiError &&
      error.status === 410 &&
      error.message === "Source unavailable.",
  );
});

test("concurrent stale-session reads share renewal and cold reads sign in before polling", async () => {
  const original = globalThis.fetch;
  let sessions = 0,
    rejected = 0;
  let release = () => {},
    announce = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    announce = resolve;
  });
  globalThis.fetch = async (input, options) => {
    if (String(input) === "/api/creator/session") {
      sessions++;
      assert.equal(new Headers(options?.headers).has("x-creator-token"), false);
      announce();
      await held;
      return Response.json({ token: "fresh-fixture" });
    }
    if (
      new Headers(options?.headers).get("x-creator-token") !== "fresh-fixture"
    ) {
      rejected++;
      return Response.json(
        { error: "Expired fixture session" },
        { status: 401 },
      );
    }
    return Response.json({ ok: true });
  };
  try {
    setToken("old-fixture");
    const reads = Promise.all([
      api("creator/state"),
      api("creator/assistance"),
    ]);
    await started;
    release();
    assert.deepEqual(await reads, [{ ok: true }, { ok: true }]);
    assert.equal(sessions, 1);
    assert.equal(rejected, 2);
    setToken("");
    await Promise.all([api("creator/state"), api("creator/assistance")]);
    assert.equal(sessions, 2);
    assert.equal(
      rejected,
      2,
      "cold requests acquire a token before accessing private endpoints",
    );
  } finally {
    release();
    globalThis.fetch = original;
    setToken("");
  }
});

test("expired mutations renew the local session but require an explicit action retry", async () => {
  const original = globalThis.fetch;
  let sessions = 0,
    writes = 0;
  globalThis.fetch = async (input, options) => {
    if (String(input) === "/api/creator/session") {
      sessions++;
      return Response.json({ token: "fresh-fixture" });
    }
    writes++;
    assert.equal(options?.method, "POST");
    assert.equal(options?.body, JSON.stringify({ version: 3 }));
    return new Headers(options?.headers).get("x-creator-token") ===
      "fresh-fixture"
      ? Response.json({ ok: true })
      : Response.json({ error: "Expired fixture" }, { status: 401 });
  };
  try {
    setToken("expired-fixture");
    await assert.rejects(
      api("creator/drafts/fixture/approve", "POST", { version: 3 }),
      (e) =>
        e instanceof ApiError &&
        e.status === 401 &&
        e.message.includes("not repeated"),
    );
    assert.equal(writes, 1);
    assert.equal(sessions, 1);
    assert.deepEqual(
      await api("creator/drafts/fixture/approve", "POST", { version: 3 }),
      { ok: true },
    );
    assert.equal(writes, 2);
  } finally {
    globalThis.fetch = original;
    setToken("");
  }
});

test("read renewal is bounded, forbidden responses do not renew and public reader calls never create creator sessions", async () => {
  const original = globalThis.fetch;
  let sessions = 0,
    reads = 0;
  globalThis.fetch = async (input) => {
    if (String(input) === "/api/creator/session") {
      sessions++;
      return Response.json({ token: "fresh-fixture" });
    }
    reads++;
    return Response.json(
      { error: "Rejected fixture" },
      { status: String(input).includes("forbidden") ? 403 : 401 },
    );
  };
  try {
    setToken("expired-fixture");
    await assert.rejects(
      api("creator/state"),
      (e) => e instanceof ApiError && e.status === 401,
    );
    assert.equal(sessions, 1);
    assert.equal(reads, 2);
    await assert.rejects(
      api("creator/forbidden"),
      (e) => e instanceof ApiError && e.status === 403,
    );
    await assert.rejects(
      api("public/replies/fixture"),
      (e) => e instanceof ApiError && e.status === 401,
    );
    assert.equal(sessions, 1);
  } finally {
    globalThis.fetch = original;
    setToken("");
  }
});

test("failed session renewal stays visible and releases the shared request for a later retry", async () => {
  const original = globalThis.fetch;
  let sessions = 0;
  globalThis.fetch = async (input, options) => {
    if (String(input) === "/api/creator/session") {
      sessions++;
      return sessions === 1
        ? Response.json({ error: "Login fixture denied" }, { status: 403 })
        : Response.json({ token: "fresh-fixture" });
    }
    return new Headers(options?.headers).get("x-creator-token") ===
      "fresh-fixture"
      ? Response.json({ ok: true })
      : Response.json({ error: "Expired fixture" }, { status: 401 });
  };
  try {
    setToken("expired-fixture");
    await assert.rejects(
      api("creator/assistance"),
      (e) => e instanceof ApiError && e.status === 403,
    );
    assert.deepEqual(await api("creator/assistance"), { ok: true });
    assert.equal(sessions, 2);
  } finally {
    globalThis.fetch = original;
    setToken("");
  }
});
