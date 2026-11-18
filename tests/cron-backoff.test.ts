import assert from "node:assert/strict";
import { after, before, test } from "node:test";

// E1 失败源指数退避：连续失败拉长间隔、成功清零；上限 24 小时。
process.env.DATABASE_PATH = ":memory:";
process.env.SITE_MODE = "selfhost";
process.env.ADMIN_TOKEN = "";

const { migrate, run, get, closeDb } = await import("../src/server/db.ts");
const { ensureSources, runSource } = await import("../src/server/collectors/index.ts");
const { effectiveIntervalSec, listDueSourceIds } = await import("../src/server/cron.ts");

const isoMinutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

before(() => {
  migrate();
  ensureSources();
  // 自检用 mock 源：config.fail=true 时故意失败
  run(
    `INSERT INTO sources (id, name, kind, enabled, config, interval_sec, created_at)
     VALUES ('mock-backoff', 'Mock 源', 'mock', 1, '{"fail":true}', 60, datetime('now'))`,
  );
});

after(() => {
  closeDb();
});

test("effectiveIntervalSec：基础间隔 × 2^连败次数，6 次封顶、总上限 24 小时", () => {
  assert.equal(effectiveIntervalSec(3600, 0), 3600);
  assert.equal(effectiveIntervalSec(3600, 1), 7200);
  assert.equal(effectiveIntervalSec(3600, 3), 28_800);
  assert.equal(effectiveIntervalSec(7200, 6), 86_400);
  assert.equal(effectiveIntervalSec(7200, 10), 86_400);
  assert.equal(effectiveIntervalSec(90, 10), 5760);
  assert.equal(effectiveIntervalSec(3600, -2), 3600);
});

test("listDueSourceIds：连败源按退避间隔到期，成功一次恢复基础间隔", () => {
  // 10 分钟前跑过、连败 3 次：有效间隔 60×8=480 秒，已到期
  run("UPDATE sources SET last_run_at = ?, consecutive_failures = 3 WHERE id = 'mock-backoff'", isoMinutesAgo(10));
  assert.ok(listDueSourceIds().includes("mock-backoff"), "连败 3 次、已过 480 秒应到期");
  // 1 分钟前跑过、连败 3 次：有效间隔 480 秒，未到期
  run("UPDATE sources SET last_run_at = ?, consecutive_failures = 3 WHERE id = 'mock-backoff'", isoMinutesAgo(1));
  assert.ok(!listDueSourceIds().includes("mock-backoff"), "连败 3 次、仅过 60 秒不应到期");
  // 同样 1 分钟前跑过、无连败：基础间隔 60 秒，已到期
  run("UPDATE sources SET last_run_at = ?, consecutive_failures = 0 WHERE id = 'mock-backoff'", isoMinutesAgo(1));
  assert.ok(listDueSourceIds().includes("mock-backoff"), "无连败、已过基础间隔应到期");
  // 从未跑过：直接到期
  run("UPDATE sources SET last_run_at = NULL, consecutive_failures = 6 WHERE id = 'mock-backoff'");
  assert.ok(listDueSourceIds().includes("mock-backoff"), "从未跑过应直接到期");
});

test("runSource：失败累计连败次数，成功一次清零", async () => {
  run("UPDATE sources SET last_run_at = NULL, consecutive_failures = 0, config = '{\"fail\":true}' WHERE id = 'mock-backoff'");
  const failCount = () => get<{ n: number }>("SELECT COALESCE(consecutive_failures, 0) AS n FROM sources WHERE id = 'mock-backoff'")!.n;

  const r1 = await runSource("mock-backoff");
  assert.equal(r1.status, "failed");
  assert.equal(failCount(), 1);

  const r2 = await runSource("mock-backoff");
  assert.equal(r2.status, "failed");
  assert.equal(failCount(), 2);

  run("UPDATE sources SET config = '{\"fail\":false}' WHERE id = 'mock-backoff'");
  const r3 = await runSource("mock-backoff");
  assert.equal(r3.status, "ok");
  assert.ok(r3.fetched > 0);
  assert.equal(failCount(), 0);
});
