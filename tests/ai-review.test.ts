import assert from "node:assert/strict";
import { after, before, test, type TestContext } from "node:test";

Object.assign(process.env, {
  DATABASE_PATH: ":memory:", ENABLE_SCHEDULER: "false",
  AI_BASE_URL: "", AI_MODEL: "", AI_API_KEY: "",
  PUSH_CHANNEL: "none", TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "",
  SITE_MODE: "selfhost", ADMIN_TOKEN: "ai-review-test",
});

const { closeDb, get, migrate, run } = await import("../src/server/db.ts");
const { DEFAULT_AI_SETTINGS, reviewItems, saveAiSettings } = await import("../src/server/enrich/ai-settings.ts");
const { reviewFreshNow } = await import("../src/server/enrich/ai-queue.ts");

const settings = {
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  baseUrl: "https://ai-review.invalid/v1",
  apiKey: "",
  model: "fixture",
  batchSize: 2,
  concurrency: 2,
  learnFromFeedback: false,
  aiDedupEnabled: false,
};
type PayloadItem = { index: number; title: string; summary: string };
const items = [0, 1, 2, 3].map((i) => ({
  externalId: String(i), title: `免费领取模型额度 ${i}`, summary: "公开活动",
  url: `https://example.invalid/ai-review/${i}`,
}));
function verdicts(payload: PayloadItem[]) {
  return payload.map((item) => ({
    index: item.index, keep: true, kind: "freebie", category: "ai",
    obtain: "free", quality: 4, reason: `fixture ${item.index}`,
  }));
}
function mockAi(t: TestContext, respond: (payload: PayloadItem[]) => unknown) {
  const requests: PayloadItem[][] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), `${settings.baseUrl}/chat/completions`);
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    const payload = JSON.parse(body.messages[1]!.content) as PayloadItem[];
    requests.push(payload);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(respond(payload)) } }] }), {
      headers: { "content-type": "application/json" },
    });
  });
  return requests;
}

before(() => {
  migrate();
  saveAiSettings(settings);
});
after(() => closeDb());

test("推送前同步审核与普通审核使用同一份正文证据", async (t) => {
  const requests = mockAi(t, verdicts);
  const now = new Date().toISOString();
  const item = { ...items[0]!, content: "领取须充值99元，且仅限新用户。" };
  const row = run(
    `INSERT INTO items(source_id,external_id,url,url_key,title,summary,content,first_seen_at,last_seen_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    "review-fixture", item.externalId, item.url, "review-body", item.title, item.summary, item.content, now, now,
  );
  await reviewFreshNow([{ ...item, itemId: Number(row.lastInsertRowid), sourceId: "review-fixture" }]);
  await reviewItems([item], settings);
  assert.equal(requests.length, 2);
  assert.ok(requests[0]![0]!.summary.includes("充值99元"));
  assert.deepEqual(requests[0], requests[1]);
});

test("合法返回允许乱序，false 保持布尔拒绝且跨批索引不串位", async (t) => {
  mockAi(t, (payload) => verdicts(payload).map((v) => ({ ...v, keep: v.index % 2 === 0 })).reverse());
  const result = await reviewItems(items, settings);
  assert.equal(result?.size, 4);
  for (let i = 0; i < items.length; i += 1) assert.equal(result?.get(i)?.keep, i % 2 === 0);
});

test("兼容缺省 kind/obtain/quality 的合法旧模型返回", async (t) => {
  mockAi(t, (payload) => payload.map((item) => ({ index: item.index, keep: true, category: "ai", reason: "有效内容" })));
  const result = await reviewItems(items.slice(0, 1), settings);
  assert.equal(result?.get(0)?.keep, true);
  assert.equal(result?.get(0)?.kind, undefined);
  assert.equal(result?.get(0)?.obtain, undefined);
});

test("无效 AI 补审不覆盖条目，也不把未审条目标记成通过", async (t) => {
  mockAi(t, (payload) => verdicts(payload).map((v) => ({ ...v, keep: "false" })));
  const now = new Date().toISOString();
  const item = items[1]!;
  const row = run(
    `INSERT INTO items(source_id,external_id,url,url_key,title,summary,kind,first_seen_at,last_seen_at)
     VALUES(?,?,?,?,?,?,'info',?,?)`,
    "review-fixture", item.externalId, item.url, "review-invalid", item.title, item.summary, now, now,
  );
  const itemId = Number(row.lastInsertRowid);
  const result = await reviewFreshNow([{ ...item, itemId, sourceId: "review-fixture" }]);
  assert.equal(result.size, 0);
  const stored = get<{ ai: string | null; ai_keep: number | null; kind: string }>("SELECT ai,ai_keep,kind FROM items WHERE id=?", itemId)!;
  assert.equal(stored.ai, null);
  assert.equal(stored.ai_keep, null);
  assert.equal(stored.kind, "info");
});

const invalidCases: Array<{ name: string; mutate: (payload: PayloadItem[]) => unknown }> = [
  { name: 'keep="false" 不能被当成 true', mutate: (p) => verdicts(p).map((v) => ({ ...v, keep: "false" })) },
  { name: "缺失 keep 不能标成已审核", mutate: (p) => verdicts(p).map(({ keep: _keep, ...v }) => v) },
  { name: "非法分类不能落库", mutate: (p) => verdicts(p).map((v) => ({ ...v, category: "invented-category" })) },
  { name: "非法形态不能落库", mutate: (p) => verdicts(p).map((v) => ({ ...v, kind: "invented-kind" })) },
  { name: "非法获取方式不能落库", mutate: (p) => verdicts(p).map((v) => ({ ...v, obtain: "invented-obtain" })) },
  { name: "字符串质量分不能当成有效评分", mutate: (p) => verdicts(p).map((v) => ({ ...v, quality: "5" })) },
  { name: "越界质量分不能当成有效评分", mutate: (p) => verdicts(p).map((v) => ({ ...v, quality: 6 })) },
  { name: "非文本理由不能落库", mutate: (p) => verdicts(p).map((v) => ({ ...v, reason: 42 })) },
  { name: "字符串索引不能导致空结果被记成功", mutate: (p) => verdicts(p).map((v) => ({ ...v, index: String(v.index) })) },
  { name: "小数索引不能串位", mutate: (p) => verdicts(p).map((v) => ({ ...v, index: v.index + 0.5 })) },
  { name: "其他批次的索引不能污染当前批次", mutate: (p) => verdicts(p).map((v) => ({ ...v, index: v.index + 2 })) },
  { name: "重复索引不能覆盖另一条资源", mutate: (p) => verdicts(p).map((v) => ({ ...v, index: p[0]!.index })) },
  { name: "漏判条目不能把批次记为全部成功", mutate: (p) => verdicts(p).slice(0, 1) },
  { name: "空数组不能把批次记为全部成功", mutate: () => [] },
];
for (const { name, mutate } of invalidCases) {
  test(`AI 响应校验：${name}`, async (t) => {
    const requests = mockAi(t, mutate);
    const result = await reviewItems(items.slice(0, 2), settings);
    assert.equal(result, null);
    assert.equal(requests.length, 2, "无效结果沿用一次重试，仍无效则保持未审");
  });
}

test("一批失败不丢弃另一批的有效结论，重试索引不覆盖已成功批次", async (t) => {
  const requests = mockAi(t, (payload) => verdicts(payload).map((v) => ({ ...v, index: v.index % 2 })));
  const result = await reviewItems(items, settings);
  assert.equal(result?.size, 2);
  assert.equal(result?.get(0)?.reason, "fixture 0");
  assert.equal(result?.get(1)?.reason, "fixture 1");
  assert.equal(result?.has(2), false);
  assert.equal(result?.has(3), false);
  assert.equal(requests.length, 3);
});

test("无效返回重试成功后使用完整的有效批次", async (t) => {
  let attempt = 0;
  mockAi(t, (payload) => ++attempt === 1 ? [] : verdicts(payload));
  const result = await reviewItems(items.slice(0, 2), settings);
  assert.equal(attempt, 2);
  assert.equal(result?.size, 2);
});

test("协议类型 response 时改走 /responses，并只取 message.output_text", async (t) => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(input), body });
    const input_ = body.input as string;
    const payload = JSON.parse(input_) as PayloadItem[];
    const output = [
      { type: "reasoning", content: [{ type: "reasoning_text", text: "不该被当成结论" }] },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(verdicts(payload)) }] },
    ];
    return new Response(JSON.stringify({ status: "completed", output }), {
      headers: { "content-type": "application/json" },
    });
  });

  const map = await reviewItems(items.slice(0, 2), { ...settings, protocol: "response" });
  assert.equal(calls.length, 1, "两次批量并发但同一批只发一次");
  assert.equal(calls[0]!.url, "https://ai-review.invalid/v1/responses");
  assert.equal(typeof calls[0]!.body.instructions, "string", "系统提示词走 instructions");
  assert.equal(calls[0]!.body.temperature, undefined, "Responses 不传 temperature");
  assert.equal(map?.size, 2, "只取 output_text，推理输出被跳过");
  assert.equal(map?.get(0)?.category, "ai");
});
