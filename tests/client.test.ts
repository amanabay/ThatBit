import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, responseValue } from "../apps/web/src/client.ts";
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
