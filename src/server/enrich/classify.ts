import { contentSignals } from "./evidence.ts";
import type { ContentKind } from "../../shared/taxonomy.ts";

/**
 * 形态（kind）判定的**唯一**依据层。
 *
 * 为什么单独一层：以前 kind 在 `guessKind` 的词法分支、AI 结论、`alignKindWithCategory`
 * 的兜底里各判一次，谁先谁后决定结果，同一条内容换条路径就换个结论（开源项目进真福利、
 * 会员权益进资讯都是这么来的）。这里只做一件事：**用证据按固定优先级裁决**，
 * 与调用路径无关，并且幂等——同一条内容判定两次结果相同。
 *
 * 四条原则：
 * 1. 事实优先于词表：价格、兑换码字段、URL 域名、分类是硬事实；标题词只是线索。
 * 2. 判「能领到什么」，不判「标题有没有说免费」。
 * 3. 每个结论都带 rule 名，线上出问题能直接定位到规则。
 * 4. 规则表就是产品定义：改顺序 = 改政策，必须同步 docs/分类说明与测试矩阵。
 */

export type KindContext = {
  title: string;
  summary?: string;
  url?: string | null;
  sourceId?: string | null;
  category?: string | null;
  obtain?: string | null;
  isFree?: boolean;
  price?: number | null;
  /** 已抽取到的兑换码数量（>0 说明确实在发东西） */
  codeCount?: number;
  freebieOnlySource?: boolean;
  kindHint?: string | null;
  guardEnabled?: boolean;
  /** 权威新闻源（CCTV/BBC 等）：疑问句标题仍然是新闻，不能被「提问」规则降级 */
  authoritativeNews?: boolean;
};

export type KindDecision = { kind: ContentKind; rule: string };

/** 仓库域名：URL 本身就是「这是一份源码/项目」的硬证据。 */
const REPO_HOST = /(?:^|\.)(?:github\.com|gitlab\.com|gitee\.com|codeberg\.org|sr\.ht|sourceforge\.net)$/i;

/** 开发者自荐：社区里「我自己做的工具」的通用文体标记，与具体平台无关。 */
const SELF_PROMO = /开发者自荐|自荐|自制|自研|个人项目|独立开发|我做了一个|我写了一个/i;

/** 权益对象：只认会员与票券码。积分/额度这类词在「扣费维权」文里太常见，会误判。 */
const ENTITLEMENT_OBJECT = /会员|VIP|年卡|月卡|季卡|天卡|兑换码|兑换券|激活码|体验券|礼品卡|充值卡/i;
/** 时效或数量：7天、×3、1个月、12个月。只提「会员」没有时效，不算在发权益。 */
const ENTITLEMENT_SHAPE = /\d+\s*(?:天|日|个?月|年)\s*(?:[×xX*]\s*\d+)?|\d+\s*[×xX*]\s*\d+/;
/** 权益类报道（涨价/停运/资费）：讲的是变化，不是发放。 */
const ENTITLEMENT_REPORT = /涨价|降价|资费|订阅费|下架|停运|关停|不再提供|取消会员|收费/i;

/** 消费维权/风险提示：这类文章常带「免费领」「会员卡」「积分」，但它是警示不是福利。 */
const CONSUMER_WARNING = /陷阱|骗局|诈骗|杀猪盘|扣费|乱扣|维权|投诉|退款|关店|倒闭|跑路|暴雷|警惕|曝光|被坑|维权/i;

/** 赠予动作：送/发/抽奖/白给。与「领取」不同，它常出现在邀请码、抽奖类帖子里。 */
const GIVEAWAY = /赠送|送出|发放|抽奖|白给|免费送|来送\s*(?:一|两|\d)|送\s*(?:一个|一份|一枚|\d)/;

/** 交易语境：有价格或买卖动作，用来把「下单赠送」和「免费公开」分开。 */
const TRANSACTION = /下单|购买|入手|抢购|年付|月付|季付|拼车|合租|明盘|出鸡|转让|出售|\d\s*(?:\/|每)\s*(?:月|年|季)/i;

export function hasRepoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return REPO_HOST.test(new URL(url).hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

export type Evidence = {
  claim: boolean;
  giveaway: boolean;
  hasCodes: boolean;
  entitlement: boolean;
  project: boolean;
  paid: boolean;
  promo: boolean;
  titleDeal: boolean;
  titlePromo: boolean;
  revoked: boolean;
  question: boolean;
  warning: boolean;
  selfPromo: boolean;
  /** 公告/发布/公测文体：讲的是「某个东西上线了」，不是「你能领什么」 */
  announcement: boolean;
  editorial: boolean;
};

export function readEvidence(ctx: KindContext): Evidence {
  const signals = contentSignals(ctx.title, ctx.summary ?? "");
  const text = `${ctx.title} ${ctx.summary ?? ""}`.slice(0, 400);

  // 付费 = 「真的要掏钱」。分两步，避免两类误判：
  //   「下单赠送礼包，年付 79 元」有购买动作 → 付费（促销赠品不等于白嫖）
  //   「移动领 1-9 元话费福利」「价值 $99 现免费领取」有领取/免费声明 → 不算付费
  const purchase = /下单|购买|入手|订购|续费|充值/.test(text);
  const receiving = /免费|限免|白嫖|喜加一|零元|领取|福利|白给|(?<![\d.])0\s*元/.test(ctx.title);
  const priceish =
    ctx.obtain === "paid" ||
    (typeof ctx.price === "number" && ctx.price > 0) ||
    // 只认带货币符号/外币单位的价格：「100 元到账」「16 元券」是福利金额，不是售价
    /[\$¥￥]\s*\d|\d+\s*(?:港币|美元|刀)\b|\d\s*(?:\/|每)\s*(?:月|年|季)/i.test(text) ||
    TRANSACTION.test(text);
  const paid = purchase || (priceish && !receiving);

  return {
    claim: signals.claim,
    giveaway: GIVEAWAY.test(text),
    hasCodes: (ctx.codeCount ?? 0) > 0,
    entitlement:
      !ENTITLEMENT_REPORT.test(ctx.title) &&
      ENTITLEMENT_OBJECT.test(text) &&
      ENTITLEMENT_SHAPE.test(text),
    // 项目证据：仓库 URL / 开源类分类 / 正文提到开源源码 / 开发者自荐文体
    project: hasRepoUrl(ctx.url) || ctx.category === "opensource" || signals.repository || SELF_PROMO.test(text),
    paid,
    promo: signals.promotion,
    // 「这是一条好价」只看标题：摘要里的参考价会把导购测评文带成 deal
    titleDeal:
      /特价|特惠|促销|折扣|史低|优惠券|优惠码|黑五|%\s*off|\d+(?:\.\d+)?\s*折|年付|月付|抢购|仅需|低至|拼车|合租|转让|出售|[\$¥￥]\s*\d|\d+\s*(?:港币|美元|元|刀)/i.test(ctx.title) ||
      TRANSACTION.test(ctx.title),
    // 只在标题里出现的价格/促销词才算「这是一条好价」，摘要里的参考价会把导购测评文带成 deal
    titlePromo: /特价|特惠|促销|折扣|史低|优惠券|优惠码|黑五|%\s*off|\d+(?:\.\d+)?\s*折|年付|月付|抢购|仅需|低至|拼车|合租|转让|出售|[\$¥￥]\s*\d/i.test(ctx.title),
    revoked: signals.revoked,
    // 提问/导购/测评文体：没有可参与的交易，交给资讯（权威新闻除外）
    question:
      (signals.question || /哪些|怎么选|如何选|值得买|测评|评测|攻略|榜单|求推荐|选购/.test(ctx.title)) &&
      !ctx.authoritativeNews,
    warning: CONSUMER_WARNING.test(text) && !ctx.authoritativeNews,
    selfPromo: SELF_PROMO.test(text),
    // 公告文体只看标题：「开启公测」「上线」「发布 3.0」这类没有可领取对象
    announcement: /公测|内测|上线|发布|首发|预告|开启|招募|发布会|新版本|正式推出/.test(ctx.title),
    editorial: signals.editorial,
  };
}

/**
 * 优先级表。第一条命中的规则即结论；顺序就是政策。
 * 线上真实样本（4000 条历史库）验证过的边界都写在注释里。
 */
const RULES: { id: string; kind: ContentKind; when: (ev: Evidence) => boolean }[] = [
  // 已撤销/已结束的免费：不再可领
  { id: "revoked", kind: "info", when: (ev) => ev.revoked },
  // 维权/风险提示先于领取： 「领免费积分反被扣费」「会员卡关店退款」讲的是警示
  // 维权/风险提示先于领取：「领免费积分反被扣费」「会员卡关店退款」讲的是警示（权威新闻除外）
  { id: "warning", kind: "info", when: (ev) => ev.warning },
  // 提问/讨论：没有可领取对象
  { id: "question", kind: "info", when: (ev) => ev.question },
  // 开发者自荐：文体本身就是「这是我做的项目」，比标题里的「免费」更能说明它是什么
  // 开发者自荐：文体本身就是「这是我做的项目」，比标题里的「免费」更能说明它是什么
  { id: "self-promo", kind: "opensource", when: (ev) => ev.selfPromo && !ev.paid },
  // 公告/公测/上线：没有可领取对象，是资讯而不是福利
  { id: "announcement", kind: "info", when: (ev) => ev.announcement && !ev.project && !ev.claim && !ev.hasCodes && !ev.giveaway && !ev.entitlement },
  // 确实在发东西：领取/兑换码字段/赠送抽奖。有价格时不成立（「下单赠礼包，年付 79」是促销）
  { id: "claim", kind: "freebie", when: (ev) => (ev.claim || ev.hasCodes || ev.giveaway) && !ev.paid },
  // 权益对象 + 时效（会员 7 天 × 3）：即使没写「免费」也是能领到的东西
  { id: "entitlement", kind: "freebie", when: (ev) => ev.entitlement && !ev.paid },
  // 项目/仓库/开发者自荐：归开源，不进真福利（真福利只收「能领到的东西」）
  { id: "project", kind: "opensource", when: (ev) => ev.project && !ev.paid },
  // 标题里就有价格/促销/交易动作，且不是提问（「哪些好喝？」不是好价）
  { id: "deal", kind: "deal", when: (ev) => !ev.question && ev.titleDeal },
];

/** 结构化裁决；null 表示没有结构性证据，交给调用方原有的词法逻辑。 */
/**
 * 是否需要人工复核：AI 判成福利，但证据里没有任何可领取对象。
 * 这类内容既不该直接上站（可能是幻觉/软广），也不必直接丢，放 review 等一眼。
 * 纯函数，方便单测；调用方负责查 override 与当前 status。
 */
export function shouldQueueForReview(input: {
  keep: boolean;
  kind: ContentKind;
  status: string;
  hasManualOverride: boolean;
  evidence: Evidence;
}): boolean {
  if (!input.keep || input.kind !== "freebie") return false;
  if (input.status !== "active" || input.hasManualOverride) return false;
  const e = input.evidence;
  return !(e.claim || e.giveaway || e.hasCodes || e.entitlement || e.project);
}

export function structuralKind(ctx: KindContext): KindDecision | null {
  const ev = readEvidence(ctx);
  for (const rule of RULES) {
    if (rule.when(ev)) return { kind: rule.kind, rule: rule.id };
  }
  return null;
}

/** 排错入口：一条内容的证据快照 + 命中的规则。后台「诊断」可据此解释判定。 */
export function explainKind(ctx: KindContext): { evidence: Evidence; decision: KindDecision | null } {
  return { evidence: readEvidence(ctx), decision: structuralKind(ctx) };
}
