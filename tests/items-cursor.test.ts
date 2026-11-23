import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Hono } from "hono";

// 测试要可重复：不读本机 .env 的站点模式与管理令牌（否则本机配了 public/ADMIN_TOKEN 就会 401/403）
process.env.DATABASE_PATH = ":memory:";
process.env.SITE_MODE = "selfhost";
process.env.ADMIN_TOKEN = "";
// 测试默认在「无管理令牌」的开放模式下跑；本机 .env 若设了 ADMIN_TOKEN，这里显式清空，
// 否则所有管理接口都会 401（那是生产行为，不是测试想要的）。
process.env.ADMIN_TOKEN = "";

const { migrate, run, closeDb } = await import("../src/server/db.ts");
const { registerApi } = await import("../src/server/routes.ts");
const { ensureSources } = await import("../src/server/collectors/index.ts");
const { mergeKey } = await import("../src/server/enrich/dedup.ts");

const app = new Hono();

before(() => {
  migrate();
  ensureSources();
  registerApi(app);
});

after(() => {
  closeDb();
});

type ItemsPage = {
  total: number;
  limit: number;
  offset: number;
  nextCursor: string | null;
  items: { id: number; title: string; score: number }[];
};

async function getPage(query: string): Promise<ItemsPage> {
  const res = await app.request(`/api/items?${query}`);
  if (res.status !== 200) assert.fail(`GET /api/items?${query} -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as ItemsPage;
}

/** 直插 n 条标题各异的条目（标题不同 → title_key 不同，merge 不会收敛）。 */
function seedRows(n: number, baseHour = 0, opts: { score?: (i: number) => number; expiresAt?: (i: number) => string | null; sameTime?: boolean } = {}) {
  const seen = new Date(Date.now() - 30 * 86_400_000).toISOString();
  for (let i = 0; i < n; i++) {
    const published = opts.sameTime
      ? new Date(Date.UTC(2026, 10, 10, 12)).toISOString()
      : new Date(Date.UTC(2026, 10, 10, baseHour + i)).toISOString();
    const title = `键集分页测试条目 ${i} 号福利免费领`;
    run(
      `INSERT INTO items (source_id, external_id, url, url_key, title, title_key, category, kind, score, expires_at, published_at, status, is_free, obtain, first_seen_at, last_seen_at)
       VALUES ('rss-ithome', ?, ?, ?, ?, ?, 'tech', 'info', ?, ?, ?, 'active', 1, 'free', ?, ?)`,
      `cursor-${baseHour}-${i}`,
      `https://example.com/cursor/${baseHour}/${i}`,
      `example.com/cursor/${baseHour}/${i}`,
      title,
      mergeKey(title),
      opts.score ? opts.score(i) : 50 + i,
      opts.expiresAt ? opts.expiresAt(i) : null,
      published,
      seen,
      seen,
    );
  }
}

/** 用 cursor 翻完全部页，返回按页收集的全部 id。 */
async function walkAll(firstQuery: string): Promise<number[]> {
  const ids: number[] = [];
  let query = firstQuery;
  for (let page = 0; page < 20; page++) {
    const json = await getPage(query);
    ids.push(...json.items.map((i) => i.id));
    if (!json.nextCursor) break;
    const next = new URLSearchParams(query);
    next.set("cursor", json.nextCursor);
    next.delete("offset");
    query = next.toString();
  }
  return ids;
}

test("GET /api/items：非合并模式 cursor 翻页不丢不重，按 newest 倒序", async () => {
  run("DELETE FROM items");
  seedRows(10);
  const p1 = await getPage("merge=0&sort=newest&limit=4");
  assert.equal(p1.items.length, 4);
  assert.ok(p1.nextCursor, "第一页应给 nextCursor");
  const p2 = await getPage(`merge=0&sort=newest&limit=4&cursor=${encodeURIComponent(p1.nextCursor!)}`);
  assert.equal(p2.items.length, 4);
  assert.ok(p2.nextCursor, "第二页应给 nextCursor");
  const p3 = await getPage(`merge=0&sort=newest&limit=4&cursor=${encodeURIComponent(p2.nextCursor!)}`);
  assert.equal(p3.items.length, 2);
  assert.equal(p3.nextCursor, null, "翻到底后 nextCursor 应为 null");
  const all = [...p1.items, ...p2.items, ...p3.items];
  assert.equal(new Set(all.map((i) => i.id)).size, 10, "三页合起来应正好 10 条不重复");
  const scores = all.map((i) => i.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), "newest 排序下分数应随发布时间倒序（seed 里分数随时间递增）");
});

test("GET /api/items：同发布时间多行靠 id 兜底，cursor 翻页不丢", async () => {
  run("DELETE FROM items");
  seedRows(5, 0, { sameTime: true });
  const ids = await walkAll("merge=0&sort=newest&limit=2");
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, 5, "同时间戳的 5 条应各出现一次");
});

test("GET /api/items：合并模式 cursor 翻页覆盖全部代表条目", async () => {
  run("DELETE FROM items");
  seedRows(12);
  const ids = await walkAll("sort=newest&limit=5");
  assert.equal(ids.length, 12);
  assert.equal(new Set(ids).size, 12, "合并模式 12 条应全翻到且不重复");
});

test("GET /api/items：score 排序 cursor 翻页按分数倒序且不丢", async () => {
  run("DELETE FROM items");
  seedRows(9, 0, { score: (i) => (i * 37) % 100 });
  const ids = await walkAll("merge=0&sort=score&limit=3");
  assert.equal(ids.length, 9);
  assert.equal(new Set(ids).size, 9);
  const first = await getPage("merge=0&sort=score&limit=3");
  // seed 分数是 (i*37)%100：i=0..8 → 0,37,74,11,48,85,22,59,96，倒序前三是 96,85,74
  assert.deepEqual(first.items.map((i) => i.score), [96, 85, 74], "第一页应为分数最高的 3 条");
});

test("GET /api/items：expiring 排序含 NULL 过期时间的行也能翻完", async () => {
  run("DELETE FROM items");
  seedRows(8, 0, {
    expiresAt: (i) => (i % 2 === 0 ? null : new Date(Date.UTC(2026, 11, 1 + i)).toISOString()),
  });
  const ids = await walkAll("merge=0&sort=expiring&limit=3");
  assert.equal(ids.length, 8);
  assert.equal(new Set(ids).size, 8, "有 NULL expires_at 的行也不应被 keyset 条件漏掉");
});

test("GET /api/items：无效 cursor 返回 400 且提示重新加载第一页", async () => {
  run("DELETE FROM items");
  seedRows(2);
  const res = await app.request("/api/items?merge=0&limit=2&cursor=%%%E4%B8%8D%E5%AF%B9");
  assert.equal(res.status, 400);
  const json = (await res.json()) as { error: string };
  assert.match(json.error, /重新加载第一页/);
});
