import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

// 在导入 db 前强制走内存库，避免污染本地 data/radar.db
process.env.DATABASE_PATH = ':memory:';

const { migrate, run, get, closeDb } = await import('../src/server/db.ts');
const { runCleanup, DEFAULT_RETENTION } = await import('../src/server/retention.ts');

before(() => {
  migrate();
});

after(() => {
  closeDb();
});

function addRun(sourceId: string, status: string, daysAgo: number): void {
  const started = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  run(
    'INSERT INTO runs (source_id, started_at, finished_at, status, fetched, inserted) VALUES (?, ?, ?, ?, 0, 0)',
    sourceId,
    started,
    started,
    status,
  );
}

function runCount(): number {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM runs')?.n ?? -1;
}

test('runCleanup：采集运行记录按状态分档保留', () => {
  addRun('s-ok-old', 'ok', 40);
  addRun('s-ok-recent', 'ok', 5);
  addRun('s-failed-mid', 'failed', 40);
  addRun('s-failed-old', 'failed', 100);
  assert.equal(runCount(), 4);
  const report = runCleanup({ ...DEFAULT_RETENTION, runsDays: 30, failedRunsDays: 90 });
  assert.equal(report.deleted['采集运行记录'], 1);
  assert.equal(report.deleted['失败的采集运行记录'], 1);
  assert.equal(runCount(), 2);
});

test('runCleanup dryRun：只统计不删除', () => {
  const beforeCount = runCount();
  const report = runCleanup({ ...DEFAULT_RETENTION, runsDays: 30, failedRunsDays: 90 }, true);
  assert.equal(report.deleted['采集运行记录'], 0);
  assert.equal(report.deleted['失败的采集运行记录'], 0);
  assert.equal(runCount(), beforeCount);
});
