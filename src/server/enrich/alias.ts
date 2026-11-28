import { all, get, run } from "../db.ts";
import { extractAliasPairs, extractMergeKeys, setTitleAliasMap } from "./dedup.ts";
import { combineScore, type ScoreBreakdown, type ScoreCtx } from "./score.ts";

/**
 * 结合 title_aliases 字典把单条标题映射到统一的 canonical title_key。
 * 当遇到包含中英双名（如《斗阵骑士 Knightica》）的条目时，
 * 自动建立中文别名 -> 英文主名映射，并把库里既有同中文名条目合并过来。
 */
const ALIAS_HINT_RE = /中文名|中文名称|官方译名|官方中文名|中文译名|中译名|译名|又名|中文叫|英文名|英文名称|英文名字|外文名|原名/;
const CJK_ONLY_RE = /^[\u4e00-\u9fff·]+$/;
const LATIN_ONLY_RE = /^[a-z0-9 '&-]+$/i;

/**
 * 从标题/正文学习「中文名 -> 英文主键」双语对照。
 * 中文源常把英文名写在正文、标题只留中文名，没有这张表就永远聚不到一起。
 */
export function learnTitleAliases(text: string): number {
  if (!text || !ALIAS_HINT_RE.test(text)) return 0;
  let learned = 0;
  for (const { latin, cjk } of extractAliasPairs(text)) {
    if (!CJK_ONLY_RE.test(cjk)) continue;
    const canonical = extractMergeKeys(latin).find((k) => LATIN_ONLY_RE.test(k) && !/[\u4e00-\u9fff]/.test(k));
    if (!canonical || canonical === cjk) continue;
    try {
      run(
        "INSERT INTO title_aliases (alias, canonical) VALUES (?, ?) ON CONFLICT(alias) DO UPDATE SET canonical = excluded.canonical",
        cjk,
        canonical,
      );
      run("UPDATE items SET title_key = ? WHERE title_key = ?", canonical, cjk);
      learned += 1;
    } catch {
      // 别名学习失败只影响聚合力度，不能影响入库
    }
  }
  if (learned) refreshTitleAliasMap();
  return learned;
}

/** 把库里的别名表灌给 dedup.ts（纯文本聚类靠它桥接中英双名）。 */
export function refreshTitleAliasMap(): void {
  try {
    const rows = all<{ alias: string; canonical: string }>("SELECT alias, canonical FROM title_aliases");
    setTitleAliasMap(new Map(rows.map((r) => [r.alias, r.canonical])));
  } catch {
    setTitleAliasMap(null);
  }
}

export function resolveDbMergeKey(title: string, summary = ""): string {
  if (summary) learnTitleAliases(summary);
  const keys = extractMergeKeys(title);
  if (!keys.length) return "";

  try {
    if (keys.length === 1) {
      const k = keys[0]!;
      const mapped = get<{ canonical: string }>("SELECT canonical FROM title_aliases WHERE alias = ?", k);
      return mapped?.canonical ?? k;
    }

    const placeholders = keys.map(() => "?").join(",");
    const existing = all<{ alias: string; canonical: string }>(
      `SELECT alias, canonical FROM title_aliases WHERE alias IN (${placeholders})`,
      ...keys,
    );
    const canonical = existing[0]?.canonical ?? keys[0]!;
    for (const k of keys) {
      if (k === canonical) continue;
      run(
        "INSERT INTO title_aliases (alias, canonical) VALUES (?, ?) ON CONFLICT(alias) DO UPDATE SET canonical = excluded.canonical",
        k,
        canonical,
      );
      run("UPDATE items SET title_key = ? WHERE title_key = ?", canonical, k);
    }
    return canonical;
  } catch {
    return keys[0]!;
  }
}

/**
 * 综合评分入口：多维加权（见 score.ts），AI 质量分占主导。
 *
 * 保持原函数名与参数顺序，额外接受一个可选的 ctx（标题/发布时间/来源/兑换码/价格）。
 * 不传 ctx 时那几个维度按中性值算，行为仍然可用——但调用方应尽量传，否则时效与来源可信度维度失效。
 */
export function calibrateScoreByObtain(
  ruleScore: number,
  obtain: string | null | undefined,
  aiKeep: boolean | null,
  quality?: number | null,
  kind?: string | null,
  ctx: ScoreCtx = {},
): number {
  return combineScore(ruleScore, obtain, aiKeep, quality, kind, ctx).total;
}

/** 需要解释分数时用这个：返回各维度得分与惩罚系数。 */
export function explainScore(
  ruleScore: number,
  obtain: string | null | undefined,
  aiKeep: boolean | null,
  quality?: number | null,
  kind?: string | null,
  ctx: ScoreCtx = {},
): ScoreBreakdown {
  return combineScore(ruleScore, obtain, aiKeep, quality, kind, ctx);
}
