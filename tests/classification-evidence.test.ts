import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

Object.assign(process.env, { DATABASE_PATH: ":memory:", SITE_MODE: "selfhost", ADMIN_TOKEN: "", NODE_ENV: "development", RATE_LIMIT_ENABLED: "false", ENABLE_SCHEDULER: "false", PUSH_CHANNEL: "none", AI_BASE_URL: "", AI_MODEL: "" });
const { migrate, run, get, closeDb } = await import("../src/server/db.ts");
const { ensureSources, ingestItems } = await import("../src/server/collectors/index.ts");
const { enrichItem } = await import("../src/server/enrich/index.ts");
const { resolveKind } = await import("../src/server/enrich/kind.ts");
const { guessObtain } = await import("../src/server/enrich/obtain.ts");
const { extractPrice } = await import("../src/server/enrich/pricing.ts");
const { reclassifyStoredItems, backfillAi } = await import("../src/server/ai-admin.ts");
const { saveAiSettings } = await import("../src/server/enrich/ai-settings.ts");
const { reviewFreshNow } = await import("../src/server/enrich/ai-queue.ts");

const now = new Date().toISOString();
const originalFetch = globalThis.fetch;
before(() => { migrate(); ensureSources(); });
after(() => { globalThis.fetch = originalFetch; closeDb(); });

const row = (externalId: string) =>
  get<{ id: number; category: string; kind: string; obtain: string; is_free: number; price: number | null; ai_keep: number | null }>(
    "SELECT id, category, kind, obtain, is_free, price, ai_keep FROM items WHERE external_id = ?", externalId)!;

const lottery = "限时抽奖送 3 份正版软件授权";
const lotterySummary = "转发活动帖参与抽奖，开奖后公布名额";

test("抽奖条目在新入库、重采、零 Token 重整后结论一致", () => {
  const first = enrichItem({ externalId: "lottery-drift", url: "https://example.com/lottery-drift", title: lottery, summary: lotterySummary }, "rss-nodeseek")!;
  assert.equal(first.obtain, "lottery");
  assert.equal(first.category, "lottery");

  ingestItems("rss-nodeseek", [{ externalId: "lottery-drift", url: "https://example.com/lottery-drift", title: lottery, summary: lotterySummary, publishedAt: now }]);
  assert.deepEqual(
    { ...row("lottery-drift") },
    { id: row("lottery-drift").id, category: "lottery", kind: "freebie", obtain: "lottery", is_free: 0, price: null, ai_keep: null },
  );

  ingestItems("rss-nodeseek", [{ externalId: "lottery-drift", url: "https://example.com/lottery-drift", title: lottery, summary: lotterySummary, publishedAt: now }]);
  const reIngest = row("lottery-drift");
  assert.equal(reIngest.category, "lottery", "重采后分类被关键词改成了 " + reIngest.category);
  assert.equal(reIngest.obtain, "lottery");

  reclassifyStoredItems("all");
  const reclassified = row("lottery-drift");
  assert.equal(reclassified.category, "lottery", "重整后分类漂成 " + reclassified.category);
  assert.equal(reclassified.obtain, "lottery", "重整后获取方式漂成 " + reclassified.obtain);
  assert.equal(reclassified.kind, "freebie");
});

test("取消免费额度后不再算免费福利", () => {
  const title = "已取消免费额度，套餐恢复原价 ￥99/月";
  const price = extractPrice(title);
  assert.equal(price.isFree, false, "取消后仍判定免费");
  assert.equal(price.price, 99, "取消免费后的原价没有被解析成价格");
  const e = enrichItem({ externalId: "revoked-free", url: "https://example.com/revoked-free", title }, "rss-ithome")!;
  assert.equal(e.isFree, false);
  assert.equal(e.obtain, "paid");
  assert.notEqual(e.kind, "freebie", "取消免费后仍被判成福利");
});

test("需要付费的套餐不能标成 free", () => {
  const e = enrichItem({ externalId: "paid-plan", url: "https://example.com/paid-plan", title: "会员套餐 99 元/月，年付更划算" }, "rss-ithome")!;
  assert.equal(e.obtain, "paid", "付费套餐被判成 " + e.obtain);
  const guarded = enrichItem({ externalId: "paid-plan-2", url: "https://example.com/paid-plan-2", title: "Only $9.99 游戏本体" }, "gamerpower")!;
  assert.equal(guarded.obtain, "paid");
  assert.notEqual(guarded.kind, "freebie");
});

test("注册验证类福利是条件福利", () => {
  assert.equal(guessObtain("注册并验证邮箱，免费领取云服务额度"), "conditional");
  assert.equal(guessObtain("绑定手机号后可领取体验金"), "conditional");
  const e = enrichItem({ externalId: "signup-verify", url: "https://example.com/signup-verify", title: "注册并验证邮箱，免费领取云服务额度" }, "linuxdo-welfare")!;
  assert.equal(e.kind, "freebie");
  assert.equal(e.obtain, "conditional");
});

test("语义明确的 AI 福利提案不被关键词未命中否决", () => {
  for (const title of ["免付费获得永久正版软件许可", "零成本拿下正版授权", "白给一套开发工具授权"]) {
    assert.equal(resolveKind("freebie", true, { title, sourceId: "rss-ithome" }), "freebie", title);
  }
  // 反例仍要压住：疑问讨论、明确标价、资讯报道
  assert.equal(resolveKind("freebie", true, { title: "AI 额度到底够不够", sourceId: "rss-ithome" }), "info");
  assert.equal(resolveKind("freebie", true, { title: "Only $9.99 付费套餐", sourceId: "rss-ithome" }), "deal");
  assert.equal(resolveKind("freebie", true, { title: "全美航班停飞4小时，普通旅客当天实际遇到了什么", sourceId: "rss-chinanews-world" }), "news");
});

test("免审来源不能把已判付费的条目改回福利", () => {
  saveAiSettings({ enabled: true, baseUrl: "https://example.invalid/v1", model: "fake-model", skipFreebieSources: true, aiDedupEnabled: false });
  try {
    ingestItems("gamerpower", [{ externalId: "skip-honor-paid", url: "https://example.com/skip-honor-paid", title: "Only $9.99 游戏本体特惠", publishedAt: now }]);
    const stored = row("skip-honor-paid");
    assert.notEqual(stored.kind, "freebie", "免审来源把付费条目改回了 freebie");
    assert.equal(stored.obtain, "paid");
    assert.equal(stored.ai_keep, null);
    ingestItems("gamerpower", [{ externalId: "skip-honor-free", url: "https://example.com/skip-honor-free", title: "Free to keep 限时免费入库", publishedAt: now }]);
    const free = row("skip-honor-free");
    assert.equal(free.kind, "freebie");
    assert.equal(free.ai_keep, 1);
  } finally {
    saveAiSettings({ enabled: false, skipFreebieSources: false });
  }
});

for (const title of ["会员套餐 99 元/月", "需付费订阅才能使用完整 API", "Only $9.99 for a lifetime license"]) {
  test(`无价格上下文的获取方式也识别付费：${title}`, () => assert.equal(guessObtain(title), "paid"));
}

for (const title of ["无需注册或验证邮箱，免费领取云服务额度", "不用绑定手机号即可免费领取授权", "免费软件注册版下载"]) {
  test(`没有注册验证要求的不误判条件：${title}`, () => assert.equal(guessObtain(title), "free"));
}

for (const title of ["取消自动续费，免费试用仍可使用", "取消付费订阅后可继续使用免费额度"]) {
  test(`取消收费不是取消免费：${title}`, () => assert.equal(extractPrice(title).isFree, true));
}

test("标题仍写免费但摘要宣布取消时，不继续存成零元", () => {
  const e = enrichItem({ externalId: "revoked-summary", url: "https://example.com/revoked-summary", title: "AI API 免费额度", summary: "免费额度已取消，套餐恢复原价 ￥99/月" }, "rss-ithome")!;
  assert.equal(e.isFree, false);
  assert.equal(e.price, 99);
  assert.equal(e.obtain, "paid");
  assert.notEqual(e.kind, "freebie");
});

test("恢复原价仍要排除赠品价值和其他历史价格", () => {
  const price = extractPrice("取消免费额度，套餐恢复原价 ￥99/月；赠品价值 ￥10，旧套餐原价 ￥199");
  assert.equal(price.isFree, false);
  assert.equal(price.price, 99);
});

test("已审英文抽奖在重采和重整后仍是 lottery，保留真实 AI 保留结论", () => {
  const item = { externalId: "cached-lottery", url: "https://example.com/cached-lottery", title: "Enter sweepstakes to win a free software license", publishedAt: now };
  ingestItems("rss-nodeseek", [item]);
  const id = row(item.externalId).id;
  run("UPDATE items SET ai=?,ai_keep=1,kind='freebie',category='software',obtain='free' WHERE id=?", JSON.stringify({ keep: true, kind: "freebie", category: "software", obtain: "free", quality: 4 }), id);
  ingestItems("rss-nodeseek", [item]);
  assert.equal(row(item.externalId).category, "lottery");
  assert.equal(row(item.externalId).obtain, "lottery");
  assert.equal(row(item.externalId).ai_keep, 1);
  reclassifyStoredItems("all", { itemId: id });
  assert.equal(row(item.externalId).category, "lottery");
  assert.equal(row(item.externalId).obtain, "lottery");
  assert.equal(row(item.externalId).ai_keep, 1);
  assert.equal(reclassifyStoredItems("all", { itemId: id }).updated, 0, "相同规则重整应幂等");
});

test("源固定领域和人工分类仍优先，获取方式独立保留抽奖约束", () => {
  const item = { externalId: "fixed-lottery", url: "https://example.com/fixed-lottery", title: "免费领取软件授权，参与抽奖获得", publishedAt: now };
  ingestItems("linuxdo-resource", [item]);
  const id = row(item.externalId).id;
  assert.equal(row(item.externalId).category, "pan");
  assert.equal(row(item.externalId).obtain, "lottery");
  ingestItems("linuxdo-resource", [item]);
  reclassifyStoredItems("all", { itemId: id });
  assert.equal(row(item.externalId).category, "pan");
  assert.equal(row(item.externalId).obtain, "lottery");
  run("INSERT INTO item_classification_overrides(item_id,category,kind,note,updated_at) VALUES(?,'course','info','人工分类测试',?)", id, now);
  ingestItems("linuxdo-resource", [item]);
  reclassifyStoredItems("all", { itemId: id });
  assert.equal(row(item.externalId).category, "course");
  assert.equal(row(item.externalId).kind, "info");
  assert.equal(row(item.externalId).obtain, "lottery");
});

test("重整修正旧的免费标记和价格；dry-run 不写入", () => {
  const item = { externalId: "legacy-revoked", url: "https://example.com/legacy-revoked", title: "AI API 免费额度", publishedAt: now };
  ingestItems("rss-ithome", [item]);
  const id = row(item.externalId).id;
  run("UPDATE items SET title='已取消免费额度，套餐恢复原价 ￥99/月',is_free=1,price=0 WHERE id=?", id);
  reclassifyStoredItems("all", { itemId: id, dryRun: true });
  assert.equal(row(item.externalId).is_free, 1);
  assert.equal(row(item.externalId).price, 0);
  reclassifyStoredItems("all", { itemId: id });
  assert.equal(row(item.externalId).is_free, 0);
  assert.equal(row(item.externalId).price, 99);
  assert.equal(row(item.externalId).obtain, "paid");
  assert.notEqual(row(item.externalId).kind, "freebie");
});

test("关键词未知只允许实际 AI 肯定提案，旧的未审核 kind 不视为 AI 结论", () => {
  const input = { title: "免付费获得永久正版软件许可", sourceId: "rss-ithome" };
  assert.equal(resolveKind("freebie", true, input), "freebie");
  assert.equal(resolveKind("freebie", null, input), "info");
  assert.equal(resolveKind("freebie", false, input), "noise");
});

const fakeVerdicts: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
  const payload = JSON.parse(body.messages[1]!.content) as { index: number }[];
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload.map(p => ({ index: p.index, keep: true, kind: "freebie", category: "software", obtain: "free", quality: 4, reason: "模拟 AI 提案" }))) } }] }), { headers: { "content-type": "application/json" } });
};

test("同步审核共用获取方式约束，AI free 不覆盖抽奖、验证和付费证据", async () => {
  const samples = [
    { externalId: "review-lottery", title: "Enter sweepstakes to win a free software license", obtain: "lottery" },
    { externalId: "review-verify", title: "注册并验证邮箱，免费领取云服务额度", obtain: "conditional" },
    { externalId: "review-paid", title: "Only $9.99 付费软件套餐", obtain: "paid" },
  ];
  for (const s of samples) ingestItems("rss-nodeseek", [{ ...s, url: `https://example.com/${s.externalId}`, publishedAt: now }]);
  globalThis.fetch = fakeVerdicts;
  saveAiSettings({ enabled: true, baseUrl: "https://example.invalid/v1", model: "fake-model", skipFreebieSources: false, aiDedupEnabled: false });
  try {
    await reviewFreshNow(samples.map(s => ({ itemId: row(s.externalId).id, sourceId: "rss-nodeseek", title: s.title, summary: "", url: `https://example.com/${s.externalId}` })));
    for (const s of samples) {
      assert.equal(row(s.externalId).obtain, s.obtain, s.title);
      assert.equal(row(s.externalId).ai_keep, 1, "分类改判不能伪造成 AI 拒绝");
    }
    assert.equal(row("review-lottery").category, "lottery");
    assert.equal(row("review-paid").kind, "deal");
  } finally { globalThis.fetch = originalFetch; saveAiSettings({ enabled: false }); }
});

test("历史补审与同步审核一样保留验证条件", async () => {
  const externalId = "backfill-verify";
  ingestItems("rss-nodeseek", [{ externalId, title: "注册并验证邮箱，免费领取软件授权", url: `https://example.com/${externalId}`, publishedAt: new Date(Date.now() + 1000).toISOString() }]);
  globalThis.fetch = fakeVerdicts;
  saveAiSettings({ enabled: true, baseUrl: "https://example.invalid/v1", model: "fake-model", skipFreebieSources: false, aiDedupEnabled: false });
  try {
    const result = await backfillAi(1, "pending");
    assert.equal(result.reviewed, 1);
    assert.equal(row(externalId).obtain, "conditional");
    assert.equal(row(externalId).ai_keep, 1);
  } finally { globalThis.fetch = originalFetch; saveAiSettings({ enabled: false }); }
});

test("免费专源的 AI 提案也不能绕过明确付费；零元则不误杀", () => {
  const input = { title: "Only $9.99 软件授权", sourceId: "gamerpower", freebieOnlySource: true };
  assert.equal(resolveKind("freebie", true, input), "deal");
  const free = enrichItem({ externalId: "zero-price", url: "https://example.com/zero-price", title: "Only $0 游戏本体" }, "gamerpower")!;
  assert.equal(free.kind, "freebie");
  assert.equal(free.obtain, "free");
  assert.equal(free.isFree, true);
});

test("CLI obtain 和 reclassify 共用证据约束，不恢复旧 AI 的 free", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-classification-cli-"));
  const script = join(dir, "check.mjs");
  const root = fileURLToPath(new URL("../", import.meta.url));
  writeFileSync(script, `
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
Object.assign(process.env, { DATABASE_PATH: ${JSON.stringify(join(dir, "fixture.sqlite"))}, AI_BASE_URL: "", AI_MODEL: "", PUSH_CHANNEL: "none", ENABLE_SCHEDULER: "false" });
globalThis.fetch = async () => { throw new Error("CLI regression must not access the network"); };
const { migrate, run, get, closeDb } = await import(${JSON.stringify(new URL("../src/server/db.ts", import.meta.url).href)});
const { ensureSources, ingestItems } = await import(${JSON.stringify(new URL("../src/server/collectors/index.ts", import.meta.url).href)});
migrate(); ensureSources();
const samples = [
  ["lottery", "Enter sweepstakes to win a free software license", "lottery"],
  ["verify", "注册并验证邮箱，免费领取软件授权", "conditional"],
  ["paid", "Only $9.99 软件套餐", "paid"],
  ["revoked", "取消免费额度，恢复原价 ￥99/月", "paid"],
];
for (const [id, title] of samples) {
  ingestItems("rss-nodeseek", [{ externalId: id, title, url: "https://example.com/cli/" + id, publishedAt: new Date().toISOString() }]);
  run("UPDATE items SET ai=?,ai_keep=1,obtain='free' WHERE external_id=?", JSON.stringify({ keep: true, kind: "freebie", category: "software", obtain: "free" }), id);
}
closeDb();
for (const args of [["obtain", "--all"], ["reclassify"]]) {
  const result = spawnSync(process.execPath, ["--no-warnings", ${JSON.stringify(fileURLToPath(new URL("../src/server/cli.ts", import.meta.url)))}, ...args], { cwd: ${JSON.stringify(root)}, env: process.env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const [id, , expected] of samples) {
    const row = get("SELECT obtain FROM items WHERE external_id=?", id);
    assert.equal(row.obtain, expected, args[0] + ": " + id);
  }
  closeDb();
}
`, "utf8");
  try {
    const result = spawnSync(process.execPath, ["--no-warnings", script], { cwd: root, env: process.env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const title of ["机票券免费取消，最高立减200元", "酒店限时特价，免费取消"]) {
  test(`免费取消服务不是撤销免费：${title}`, () => {
    assert.equal(guessObtain(title), "free");
    assert.equal(extractPrice(title).isFree, false, "免费取消不代表机票或酒店免费");
  });
}

for (const [title, expectedPrice] of [["会员 99 元/月，含免费额度 100 次", 99], ["Google One 会员 9.99 美元/月，含免费额度", 71.93], ["Only $9.99 软件套餐附送免费授权", 71.93]] as const) {
  test(`套餐实付价优先于附送免费额度：${title}`, () => {
    const price = extractPrice(title);
    assert.equal(price.isFree, false);
    assert.equal(price.price, expectedPrice);
    assert.equal(guessObtain(title), "paid");
    const item = { externalId: `priced-extra-${title}`, url: `https://example.com/priced-extra/${encodeURIComponent(title)}`, title, publishedAt: now };
    const e = enrichItem(item, "rss-ithome")!;
    assert.equal(e.kind, "deal");
    assert.equal(e.obtain, "paid");
    ingestItems("rss-ithome", [item]);
    assert.equal(row(item.externalId).price, expectedPrice);
    assert.equal(row(item.externalId).is_free, 0);
    assert.equal(row(item.externalId).obtain, "paid");
  });
}

for (const title of ["免费领取软件授权，原价 ￥99", "Free software license, normally $99", "Free license ($99 value)", "Free trial for 14 days, then $9.99/month"]) {
  test(`原价价值和试用后收费不误读为当前收费：${title}`, () => {
    const price = extractPrice(title);
    assert.equal(price.isFree, true);
    assert.equal(price.price, 0);
  });
}

// 真福利频道只收「真能领到的东西」：安全事件、破解打包、已领完的都不该靠 AI 一句话混进去
const { enforceFreebieEvidence } = await import("../src/server/enrich/index.ts");

for (const title of [
  "日本“三井购物公园”App 遭黑客非法访问，311.9 万名会员个人信息外泄",
  "日本京王集团披露 9 月黑客攻击事件影响：约 1063 万客户信息遭泄露",
]) {
  test(`安全事件报道不进真福利：${title.slice(0, 18)}`, () => {
    const out = enforceFreebieEvidence("freebie", "free", title, "security", {
      summary: "据日媒 ITMedia 报道，公司昨日发布通报，称 App 遭到黑客非法访问，导致会员个人信息外泄。",
    });
    assert.equal(out.kind, "info");
    assert.equal(out.obtain, null);
  });
}

for (const title of [
  "Zero Trust & SASE — Up to 50 Users, 24 hours of activity log",
  "【薅毛必备】Firefox 自带免费 VPN ，每月 50GB 流量",
  "分享一个订阅链接",
]) {
  test(`安全类里真能白拿的保留 freebie：${title.slice(0, 18)}`, () => {
    assert.equal(enforceFreebieEvidence("freebie", "free", title, "security", {}).kind, "freebie");
  });
}

for (const title of [
  "ZArchiver Pro v1.0.10 for Android 捐赠专业版 + ZArchiver v1.0.10 —— 完美支持中文",
  "Flowx Pro v4.654 for Android 解锁专业版 —— 独特的可视化天气预报",
  "Adobe Photoshop Express Pro v18.6.46 for Android 直装解锁高级版",
]) {
  test(`解锁/捐赠版是重新打包的软件，不算白拿福利：${title.slice(0, 16)}`, () => {
    assert.equal(enforceFreebieEvidence("freebie", "free", title, "software", {}).kind, "info");
  });
}

for (const title of ["（已无）美团单车七天无限次骑行卡", "美团单车7天无限次卡还有5次可以领（已无）", "会员月卡已领完", "【已无，后续看情况再来第三弹】什么？gpt又重置了？"]) {
  test(`标题自己写已无的福利不进真福利：${title.slice(0, 14)}`, () => {
    assert.equal(enforceFreebieEvidence("freebie", "conditional", title, "offline", {}).kind, "info");
  });
}

for (const title of [
  "2027 國定假日行事曆訂閱：nongminli.tw 免費 .ics 網址，iPhone、Google、Outlook 都能加",
  "掘金小册-合集 整理",
  "B0038 清华博士后的DeepSeek使用手册，104页",
]) {
  test(`只是给个地址/资料的资源帖不算真福利：${title.slice(0, 16)}`, () => {
    assert.equal(enforceFreebieEvidence("freebie", "free", title, "tech", {}).kind, "info");
  });
}

for (const title of [
  "【开发者自荐】一起野：免费的多人露营装备认领清单，无需注册",
  "免费领取 3 个月 Gemini Pro（附领取链接）",
  "Epic 喜加一：《Bread and Fred》游戏免费领取",
]) {
  test(`有领取动作的仍算真福利：${title.slice(0, 16)}`, () => {
    assert.equal(enforceFreebieEvidence("freebie", "free", title, "ai", {}).kind, "freebie");
  });
}

for (const title of ["账号已无法登录，求助怎么找回"]) {
  test(`「已无法…」不是已领完：${title.slice(0, 10)}`, () => {
    assert.notEqual(enforceFreebieEvidence("freebie", "free", title, "ai", {}).kind, "info");
  });
}
