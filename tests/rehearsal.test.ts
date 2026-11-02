import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { readFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { OperationsSnapshot } from "../shared/contracts/operations.ts";
import { summarizeRehearsal } from "../apps/server/src/domain/rehearsal.ts";
const fixture = OperationsSnapshot.parse({
  sampledAt: "2026-10-30T12:00:00Z",
  scope:
    "creator process only; excludes reader, OBS and media/model subprocess resources",
  resources: {
    instanceId: "fixture-creator-1",
    rssBytes: 100000,
    cpuUserMicros: 10,
    cpuSystemMicros: 10,
    uptimeSeconds: 1,
    diskFreeBytes: 1000000,
  },
  storage: { sourceCount: 2, sourceBytes: 10000 },
  queues: { render: 0, transcription: 0, suggestions: 0, reader: 0 },
  failures: { render: 0, transcription: 0, suggestions: 0, reader: 0 },
});
test("rehearsal summary reports gaps, restart-safe CPU, declared scope and thresholds without claiming human acceptance", () => {
  const next = {
    ...fixture,
    resources: {
      ...fixture.resources,
      uptimeSeconds: 2,
      cpuUserMicros: 500010,
      cpuSystemMicros: 500010,
    },
  };
  const report = summarizeRehearsal([fixture, next], 0, 2, 2, false);
  assert.equal(report.peakCreatorCpuCorePercent, 100);
  assert.equal(
    summarizeRehearsal(
      [
        fixture,
        {
          ...next,
          resources: { ...next.resources, instanceId: "fixture-restarted" },
        },
      ],
      0,
      2,
      2,
      false,
    ).peakCreatorCpuCorePercent,
    null,
  );
  assert.equal(report.outcome, "observed-within-sampled-limits");
  assert.match(report.purpose, /short diagnostic/);
  assert.match(report.humanAcceptance, /NOT TESTED/);
  assert.equal(
    summarizeRehearsal([next, fixture], 0, 2, 2, false)
      .peakCreatorCpuCorePercent,
    null,
  );
  assert.equal(
    summarizeRehearsal([fixture], 1, 1800, 1800, false).outcome,
    "incomplete-gaps",
  );
  assert.equal(
    summarizeRehearsal(
      [
        {
          ...fixture,
          resources: { ...fixture.resources, rssBytes: 2 * 1024 ** 3 },
        },
      ],
      0,
      2,
      2,
      false,
    ).outcome,
    "threshold-exceeded",
  );
  assert.equal(
    summarizeRehearsal([fixture], 0, 2, 1, true).outcome,
    "interrupted",
  );
});
test("read-only rehearsal CLI writes private allowlisted samples, omits tokens/content and refuses overwrite (HTTP fixture)", async () => {
  const root = join(".data", "rehearsal-test-" + randomUUID()),
    path = join(root, "fixture.jsonl");
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(req.url ?? "");
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/creator/session")
      return res.end(JSON.stringify({ token: "PRIVATE_FIXTURE_TOKEN" }));
    assert.equal(req.headers["x-creator-token"], "PRIVATE_FIXTURE_TOKEN");
    if (req.url !== "/api/creator/operations") {
      res.statusCode = 404;
      return res.end("{}");
    }
    res.end(
      JSON.stringify({
        ...fixture,
        privateTranscript: "PRIVATE_CONTENT",
        resources: { ...fixture.resources, secret: "PRIVATE_RESOURCE" },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const args = [
      "--import",
      "tsx",
      "scripts/rehearse.ts",
      "--seconds",
      "1",
      "--interval",
      "1",
      "--out",
      path,
    ];
    const result = await promisify(execFile)(process.execPath, args, {
      env: { ...process.env, PORT: String(address.port) },
      timeout: 15000,
    });
    const samples = await readFile(path, "utf8"),
      summary = await readFile(path + ".summary.json", "utf8");
    assert.ok(
      ![samples, summary, result.stdout, result.stderr]
        .join("")
        .includes("PRIVATE_"),
    );
    if (process.platform !== "win32") {
      assert.equal((await stat(path)).mode & 0o777, 0o600);
      assert.equal((await stat(path + ".summary.json")).mode & 0o777, 0o600);
    }
    assert.equal(
      JSON.parse(summary).humanAcceptance,
      "NOT TESTED by this tool",
    );
    assert.ok(
      seen.every(
        (p) => p === "/api/creator/session" || p === "/api/creator/operations",
      ),
    );
    await assert.rejects(
      promisify(execFile)(process.execPath, args, {
        env: { ...process.env, PORT: String(address.port) },
        timeout: 15000,
      }),
    );
    assert.equal(await readFile(path, "utf8"), samples);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  }
});
