import { DEAL_HINT, isNoiseTitle, OPENSOURCE_HINT, PROMO_HINT } from "./noise.ts";
import { readEvidence, structuralKind } from "./classify.ts";
import { KIND_LABEL, KIND_SET, isContentKind, type ContentKind } from "../../shared/taxonomy.ts";
import { contentSignals } from "./evidence.ts";
import { guessObtain } from "./obtain.ts";

export type { ContentKind };
export { KIND_LABEL, isContentKind };
/** 兼容旧名：可被识别的全部形态（含 noise）。 */
export { KIND_SET as VALID_KINDS };

const OPENSOURCE_SOURCES = new Set([
  "github-free-for-dev",
  "github-public-apis",
  "github-awesome-ai",
  "github-selfhosted",
]);

const DEAL_SOURCES = new Set([
  "rss-lowendbox",
  "rss-lowendtalk",
  "rss-lowendspirit",
  "rss-vpsgo",
  "rss-vpsxb",
  "rss-reddit-gamedeals",
  "rss-reddit-googleplay",
  "rss-9to5toys",
  "rss-slickdeals",
  "rss-hip2save",
  "rss-ozbargain",
  "rss-smzdm",
]);

export const NEWS_SOURCES = new Set([
  "cctv-news",
  "rss-chinanews-scroll",
  "rss-chinanews-china",
  "rss-chinanews-world",
  "rss-bbc-zh",
  "rss-dw-cn",
  "rss-rfi-cn",
  "rss-gnews-cn",
  "rss-gnews-world",
  "rss-nikkei-cn",
  "rss-voa-cn",
]);

export function isAuthoritativeNewsSource(
  sourceId: string | null | undefined,
  kindHint?: string | null,
): boolean {
  return kindHint === "news" || Boolean(sourceId && NEWS_SOURCES.has(sourceId));
}

const INFO_SOURCES = new Set([
  "cctv-economy",
  "cctv-tech",
  "rss-wallstreetcn",
  "rss-chinanews-finance",
  "rss-chinanews-it",
  "rss-ruanyifeng",
  "rss-sspai",
  "rss-appinn",
  "rss-producthunt",
  "rss-hnrss",
  "rss-ithome",
  "rss-v2ex-tech",
  "rss-solidot",
]);

/**
 * 规则兜底推断内容形态（AI 未审或未返回 kind 时使用）。
 * 原则：硬噪音判 noise；明确开源且无纯白嫖词判 opensource；付费/黑五/特价促销判 deal；
 * 权威时政/国际要闻判 news；经济/股票/科技/深度指南判 info；其余按免费信号落位。
 */
export function guessKind(input: {
  title: string;
  summary?: string;
  sourceId?: string;
  category?: string | null;
  obtain?: string | null;
  isFree?: boolean;
  price?: number | null;
  freebieOnlySource?: boolean;
  kindHint?: string | null;
  guardEnabled?: boolean;
}): ContentKind {
  const title = input.title ?? "";
  const text = `${title} ${input.summary ?? ""}`;
  const guard = input.guardEnabled !== false;
  const signals = contentSignals(title, input.summary);
  if (isNoiseTitle(title)) return "noise";
  if (input.freebieOnlySource) {
    if (signals.revoked || (guard && signals.editorial)) return isAuthoritativeNewsSource(input.sourceId, input.kindHint) ? "news" : "info";
    if (input.obtain === "paid" || (!input.isFree && typeof input.price === "number" && input.price > 0) || guessObtain(title, input.summary) === "paid") return "deal";
    return "freebie";
  }
  if (input.kindHint && isContentKind(input.kindHint) && input.kindHint !== "noise") {
    if (!guard || !["freebie", "deal", "opensource"].includes(input.kindHint) ||
        (input.kindHint === "freebie" && signals.claim) || (input.kindHint === "deal" && signals.promotion) ||
        (input.kindHint === "opensource" && signals.repository)) return input.kindHint;
  }
  if (guard && signals.editorial) return isAuthoritativeNewsSource(input.sourceId, input.kindHint) ? "news" : "info";

  const hasDealWord = guard ? signals.claim : DEAL_HINT.test(title);
  const hasPromoWord = guard ? signals.promotion : PROMO_HINT.test(text);
  const hasOpenSource = guard ? signals.repository : input.category === "opensource" || OPENSOURCE_HINT.test(text);
  // 结构化裁决：价格 / 兑换码 / 仓库 URL / 来源性质 / 权益时效。顺序见 classify.ts 的 RULES。
  const structural = structuralKind({
    title,
    summary: input.summary,
    url: (input as { url?: string | null }).url ?? null,
    sourceId: input.sourceId,
    category: input.category,
    obtain: input.obtain,
    isFree: input.isFree,
    price: input.price,
    codeCount: (input as { codeCount?: number }).codeCount,
    authoritativeNews: isAuthoritativeNewsSource(input.sourceId, input.kindHint),
    freebieOnlySource: input.freebieOnlySource,
  });
  if (structural && !(guard && signals.editorial)) return structural.kind;
  if (input.sourceId && OPENSOURCE_SOURCES.has(input.sourceId) && !hasDealWord && (!guard || signals.repository)) {
    return "opensource";
  }

  const hasPaidPrice = !input.isFree && typeof input.price === "number" && input.price > 0;
  if ((input.obtain === "paid" || hasPaidPrice) && (!guard || signals.promotion)) {
    return "deal";
  }
  if (hasPromoWord && !hasDealWord && !input.isFree) {
    return "deal";
  }
  // 交易/拼车类：分类本身已确认是「明盘出鸡 / 发车合租」，不再额外要求促销词
  // （「50出」「溢价50出」「出租…车位」都不含促销词，旧逻辑因此把它们判成 info）
  if ((input.category === "carpool" || input.category === "trade") && !hasDealWord) {
    return "deal";
  }
  if (input.sourceId && DEAL_SOURCES.has(input.sourceId) && !input.isFree && !hasDealWord && (!guard || signals.promotion)) {
    return "deal";
  }

  if (input.sourceId && NEWS_SOURCES.has(input.sourceId)) return "news";
  if ((!guard && input.isFree) || hasDealWord) return "freebie";
  if (input.sourceId && INFO_SOURCES.has(input.sourceId)) return "info";
  if (input.category === "opensource" && (!guard || signals.repository)) return "opensource";
  if (
    input.category === "stock" ||
    input.category === "finance" ||
    input.category === "tech" ||
    input.category === "news" ||
    input.category === "edu"
  ) {
    // 非权威新闻源（如什么值得买/IT之家/社区）不得落入 news，统一归为 info（导购站由上方 DEAL_SOURCES 先拦）
    return "info";
  }
  return guard ? "info" : "freebie";
}

function coerceNonNewsKind(fallbackInput: Parameters<typeof guessKind>[0]): ContentKind {
  if (
    fallbackInput.sourceId &&
    DEAL_SOURCES.has(fallbackInput.sourceId) &&
    !fallbackInput.isFree &&
    !DEAL_HINT.test(fallbackInput.title ?? "") && fallbackInput.guardEnabled === false
  ) {
    return "deal";
  }
  const guessed = guessKind(fallbackInput);
  return guessed === "noise" || (guessed === "news" && !isAuthoritativeNewsSource(fallbackInput.sourceId, fallbackInput.kindHint)) ? "info" : guessed;
}

const TRADE_LIKE_CATEGORIES = new Set(["trade", "carpool", "goods"]);

/**
 * 分类与形态的一致性约束（最后一道闸）。
 * 分类已经确认是「二手交易 / 拼车合租 / 实物优惠」时，形态不可能是「行业资讯」：
 * 以前这里只做单向降级（AI 说 deal 但没促销词就打回 info），于是出现
 * category=trade + kind=info 的自相矛盾组合（全库 500+ 条）。
 */
export function alignKindWithCategory(
  kind: ContentKind,
  input: Parameters<typeof guessKind>[0],
): ContentKind {
  if (kind === "noise") return kind;
  const category = input.category;
  const signals = contentSignals(input.title, input.summary);
  // 付费判断复用 classify 的口径（标题里的年付/$/年、交易动词都算），避免两套 paid 定义各说各话
  const paidish = readEvidence({ ...input, authoritativeNews: isAuthoritativeNewsSource(input.sourceId, input.kindHint) }).paid;
  // 开源 / 开发者作品：即使免费也归「开源项目」，不该出现在真福利频道。
  // 明确领取证据（免费领、兑换码）优先，避免把「GitHub 学生包免费领」这类真福利改走。
  // 同一套结构化规则再跑一次：AI 的结论不能违反证据（开源项目不为「免费」让路，
  // 会员权益也不因没写「免费」两个字变成资讯）。顺序见 classify.ts 的 RULES。
  const structural = structuralKind({ ...input, authoritativeNews: isAuthoritativeNewsSource(input.sourceId, input.kindHint) });
  if (structural && !signals.editorial) return structural.kind;
  if (kind === "news") return kind;
  if (!category || !TRADE_LIKE_CATEGORIES.has(category)) return kind;
  // 有明确领取/白送证据且不需要付费的实物福利归 freebie（如「免费送小鸡」「PDD 免费领」）；
  // 需要付费的「领取优惠券」仍是好价，不能因为出现「领取」就变福利
  if (signals.claim && !paidish) return "freebie";
  // 编辑性内容（财报/事故/政策报道）撞上交易词时不硬改
  if (signals.editorial && !signals.promotion) return kind;
  // 交易/拼车：分类已确认是明盘转让或发车，形态就是 deal
  if (category === "trade" || category === "carpool") return "deal";
  // goods（实物/优惠）默认不是资讯：AI 没给形态时按价格/免费信号落位
  if (category === "goods" && kind === "info") {
    if (signals.claim) return "freebie";
    if (paidish) return "deal";
    // 注意：obtain=free 只代表「没检测到价格」，不是福利证据；
    // 用它兜底会把「什么值得买」的测评文全判成白嫖福利。
  }
  // goods：有价格或促销证据才算好价，其余保留原判
  return paidish || signals.promotion ? "deal" : kind;
}

/**
 * 最终形态。**AI 是基准，规则只做初筛与兜底**：
 * - AI 已给出合法形态且未判噪音 → 直接采用，只有「硬矛盾」才纠正
 * - AI 未给结论（未启用 / 未审 / 返回空）→ 规则兜底：结构化证据优先，其次词法
 */
export function resolveKind(
  aiKind: unknown,
  aiKeep: boolean | null | undefined,
  fallbackInput: Parameters<typeof guessKind>[0],
): ContentKind {
  if (aiKeep === false) return "noise";
  // 只有「AI 真的判过」（aiKeep === true）才采信它的形态；未审条目的 aiKind 可能是旧规则值
  if (aiKeep === true && isContentKind(aiKind) && aiKind !== "noise") {
    if (fallbackInput.guardEnabled === false) return aiKind;
    return hardContradiction(aiKind, fallbackInput) ?? aiKind;
  }
  const ctx = { ...fallbackInput, authoritativeNews: isAuthoritativeNewsSource(fallbackInput.sourceId, fallbackInput.kindHint) };
  const structural = structuralKind(ctx);
  if (structural) return structural.kind;
  if (aiKeep === true && fallbackInput.category === "opensource") return "opensource";
  const guessed = guessKind(fallbackInput);
  if (guessed === "noise" && aiKeep === true) return "freebie";
  return alignKindWithCategory(guessed, fallbackInput);
}

/**
 * 硬矛盾：只有「证据在物理上不允许这个形态」时才推翻 AI。
 * 语义偏好（「我觉得这更像资讯」）不作为推翻理由——那是模型该判的事。
 */
function hardContradiction(aiKind: ContentKind, input: Parameters<typeof guessKind>[0]): ContentKind | null {
  const ev = readEvidence({ ...input, authoritativeNews: isAuthoritativeNewsSource(input.sourceId, input.kindHint) });
  // 交易/拼车分类 + 交易证据：业务上就是一条成交/发车信息，任何语义形态都让位给 deal
  if (aiKind !== "deal" && (input.category === "trade" || input.category === "carpool") && (ev.titleDeal || ev.paid)) return "deal";
  switch (aiKind) {
    case "freebie": {
      // 1. 已撤销/已到期 → 不再是福利
      if (ev.revoked) return "info";
      // 2. 维权/风险提示文（领积分反被扣费、会员卡关店）
      if (ev.warning) return "info";
      // 3. 提问/报道体裁且没有任何可领取对象 → 资讯（权威新闻源给 news）
      // 3. 只介绍项目、没有任何可领取对象 → 开源项目（先于公告判断，开源项目发版不是资讯）
      if (ev.project && !ev.claim && !ev.giveaway && !ev.hasCodes && !ev.entitlement) return "opensource";
      // 4. 提问/报道/公告体裁且没有任何可领取对象 → 资讯（权威新闻源给 news）
      if ((ev.question || ev.editorial || ev.announcement) && !ev.claim && !ev.giveaway && !ev.hasCodes && !ev.entitlement) {
        return isAuthoritativeNewsSource(input.sourceId, input.kindHint) ? "news" : "info";
      }
      // 4. 明确价格/交易动作（含标题里的 年付/$99）→ 好价
      if (ev.paid) return "deal";
      // 5. 只介绍项目、没有任何可领取对象 → 开源项目，不是福利
      if (ev.project && !ev.claim && !ev.giveaway && !ev.hasCodes && !ev.entitlement) return "opensource";
      return null;
    }
    case "deal":
      // 交易/拼车分类本身已确认有交易对象，AI 判 deal 直接成立
      if (input.category === "trade" || input.category === "carpool") return null;
      // 好价必须有可参与的价格、促销或交易动作；新闻事件里的金额不是售价
      if (ev.editorial && !ev.titleDeal) return isAuthoritativeNewsSource(input.sourceId, input.kindHint) ? "news" : "info";
      if (ev.titleDeal || ev.paid) return null;
      return ev.claim ? "freebie" : "info";
    case "news":
      // 重要新闻只收权威新闻源
      if (isAuthoritativeNewsSource(input.sourceId, input.kindHint)) return null;
      // 交易类分类且带交易证据时，业务上就是好价，不能落资讯
      return (input.category === "trade" || input.category === "carpool") && (ev.titleDeal || ev.paid) ? "deal" : "info";
    case "opensource":
      // 说是开源项目却没有任何项目证据、且确实在发东西 → 那就是福利
      // 没有任何项目证据（仓库链接/开源词/自荐文体）却说是开源 → 模型幻觉，按证据落位
      if (!ev.project) return ev.claim && !ev.paid ? "freebie" : "info";
      return null;
    case "info":
      // 证明确实在发权益：「会员 7 天×3」不该被当成行业资讯
      if (ev.entitlement && !ev.paid) return "freebie";
      // 交易/拼车分类，且有交易证据（价格、促销或撮合动作）→ 好价；只挂个分类不算证据
      return (input.category === "trade" || input.category === "carpool") && (ev.titleDeal || ev.paid) ? "deal" : null;
    default:
      return null;
  }
}
