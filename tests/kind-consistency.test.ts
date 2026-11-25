import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveKind, guessKind } from "../src/server/enrich/kind.ts";
import { CATEGORY_KEYS, KIND_ORDER } from "../src/shared/taxonomy.ts";
import { structuralKind, explainKind } from "../src/server/enrich/classify.ts";

/**
 * 这一组不测「某条文案 → 某个结论」，那叫过拟合。
 * 测的是判定层的三条性质，它们对**任何**输入都必须成立：
 *   1. 幂等：同一条内容判两次结论相同（换路径不会换结论）
 *   2. 无矛盾：结论与分类/价格事实不自相矛盾
 *   3. 可解释：每个非词法结论都能说出命中的规则
 */

const ALL_CATEGORIES = CATEGORY_KEYS as readonly string[];
const KINDS = [...KIND_ORDER, "noise"] as const;


const form = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  summary: "",
  obtain: "free",
  isFree: true,
  price: 0,
  ...extra,
});

test("幂等：AI 结论与规则结论互相喂一遍，结果不变", () => {
  const titles = [
    "Epic 本周喜加一：《心灵杀手：复刻版》免费领取",
    "【开发者自荐】BooMO：美观、直观的 Chrome 书签管理器",
    "喜马拉雅会员7天*3",
    "RackNerd 黑五特价 2KVM VPS 年付 $10.99",
    "(YMMV) nodaroo 免费VPS 6GB内存50GB储存 留档",
    "多家视频平台会员涨价，年卡价格上调",
    "【收】溢价160收 原生ip 299/年",
    "全美航班停飞4小时，普通旅客当天实际遇到了什么",
  ];
  for (const title of titles) {
    for (const category of ["media", "opensource", "software", "vps", "tech", "trade", "other"]) {
      const ctx = form(title, { category, sourceId: "linuxdo-welfare" });
      const first = resolveKind("freebie", true, ctx);
      const second = resolveKind(first, true, ctx);
      assert.equal(second, first, `不幂等：${title} (${category}) ${first} → ${second}`);
    }
  }
});

test("无矛盾：分类 × 形态的每个组合都不会产生自相矛盾的结论", () => {
  for (const category of ALL_CATEGORIES) {
    for (const kind of KINDS) {
      const ctx = form("示例条目", { category });
      const out = resolveKind(kind, kind === "noise" ? false : true, ctx);
      assert.ok(KINDS.includes(out), `${category}/${kind} → 非法形态 ${out}`);
      // 交易类分类 + 交易证据（价格/撮合动作）时，不允许落成「资讯」
      if (category === "trade" || category === "carpool") {
        const priced = resolveKind(kind, kind === "noise" ? false : true, form("出 一台小鸡 溢价 50 元", { category, price: 50, isFree: false }));
        assert.notEqual(priced, "info", `${category} 有价格仍被判成 info`);
      }
    }
  }
});

test("可解释：命中的结论必须能给出规则名或落回词法层", () => {
  const samples = [
    { title: "喜马拉雅会员7天*3", category: "media" },
    { title: "【开发者自荐】ClickPulse：键盘鼠标统计工具", category: "software" },
    { title: "限时下单赠送礼包，年付79元", category: "other" },
    { title: "领100美元免费积分，反被偷设陷阱疯狂扣费", category: "ai" },
    { title: "某某面板 v2.0 发布", category: "opensource", summary: "GitHub 开源项目" },
  ];
  for (const s of samples) {
    const ctx = form(s.title, { category: s.category, summary: s.summary ?? "" });
    const { decision } = explainKind(ctx);
    const out = resolveKind("freebie", true, ctx);
    if (decision) assert.ok(decision.rule.length > 0, `规则名为空：${s.title}`);
    // 结构化结论与最终结论必须一致，除非被"权威新闻/编辑性内容"这类上层例外拦下
    if (decision) assert.equal(decision.kind, out, `${s.title}: 结构化 ${decision.kind} ≠ 最终 ${out}`);
  }
});

test("真实回归锚点：线上错审的三条已修正（细节见 classify.ts 规则注释）", () => {
  const boomo = form("【开发者自荐】BooMO：美观、直观的 Chrome 书签管理器", { category: "software", sourceId: "rss-meta-appinn" });
  assert.equal(guessKind(boomo), "opensource");
  assert.equal(resolveKind("freebie", true, boomo), "opensource");

  const macos = form("终于可以在 macOS 的快速查看里编辑了", { category: "opensource" });
  assert.equal(guessKind(macos), "opensource");

  const ximalaya = form("喜马拉雅会员7天*3", { category: "media", sourceId: "linuxdo-welfare" });
  assert.equal(guessKind(ximalaya), "freebie");
  assert.equal(resolveKind("info", true, ximalaya), "freebie");
});

test("真实回归锚点：真实库跑出来的反例都守住了", () => {
  // 权威新闻的疑问句标题不能被「提问」规则降级
  assert.equal(
    resolveKind("news", true, form("老龄陪伴式服务如何让陪伴服务更可持续？", { sourceId: "cctv-news" })),
    "news",
  );
  // 消费维权文里的「免费领」「会员卡」不是福利
  assert.notEqual(resolveKind("freebie", true, form("领100美元免费积分，反被Claude偷设陷阱疯狂扣费", { category: "ai" })), "freebie");
  assert.notEqual(resolveKind("deal", true, form("Blueglass关店潮：闭店前办的会员卡，钱还能要回来", { category: "goods" })), "freebie");
  // 促销赠品不是白嫖
  assert.equal(resolveKind("deal", true, form("限时下单赠送礼包，年付79元")), "deal");
  // 明确赠送仍然可以进真福利（邀请码/抽奖）
  assert.equal(resolveKind("freebie", true, form("周一了，继续来送一个邀请码")), "freebie");
  // 公告/公测/上线体裁：没有可领取对象时是资讯（此前「开启公测」「发布」被当成福利）
  assert.equal(resolveKind("freebie", true, form("豆包旗下 AI 助理开启公测")), "info");
  // 无结构证据（既非公告也非领取）时不擅自改判，交给词法层与 AI
  assert.equal(structuralKind(form("某某面板 v3.1 观察")), null);
});

test("AI 是基准：规则不因语义偏好推翻已判结论，只修硬矛盾", () => {
  const keep = (aiKind: string, title: string, extra: Record<string, unknown> = {}) =>
    resolveKind(aiKind, true, form(title, extra));

  // 语义分歧不算矛盾：AI 说资讯，规则觉得「像福利」，但没有任何领取证据 → 保留 AI
  assert.equal(keep("info", "聊聊最近几个限时免费的思路"), "info");
  // AI 说开源，且有项目证据 → 保留
  // AI 说开源，且有项目证据（「开源」/仓库/自荐文体）→ 保留
  assert.equal(keep("opensource", "轻舟文件：开源的 Mac 文件管理器"), "opensource");
  // 没有任何项目证据却说是开源 → 模型幻觉，按证据回落资讯
  assert.equal(keep("opensource", "聊聊最近的内容管理"), "info");
  // 硬矛盾才纠正：AI 说免费但标题明确标价
  assert.equal(keep("freebie", "Only $9.99 付费套餐"), "deal");
  // 硬矛盾：AI 说好价但标题没有任何价格/促销/交易动作
  assert.equal(keep("deal", "聊聊最近的开源项目"), "info");
  // 未审（aiKeep 为 null）不视为 AI 结论，走规则兜底
  assert.notEqual(resolveKind("freebie", null, form("某条目的旧 kind")), "freebie");
});
