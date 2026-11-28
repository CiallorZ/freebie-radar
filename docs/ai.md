# AI 语义审核设计与调优说明

## 为什么需要 AI 语义审核

靠纯关键词和正则永远无法彻底分清以下几种情况：

- **资讯与讨论帖**：标题带有「免费」「API」「云」等关键词，但实际是行业新闻或吐槽；
- **求助与交易帖**：「求推荐免费图床」「谁有优惠券」「溢价出闲置服务器」；
- **更新补丁帖**：「某付费游戏免费更新新地图」（本体仍需购买，非免费领本体）；
- **真实白嫖与攻略**：例如「Epic 本周限免」「OpenRouter 新增 :free 模型」「白嫖了台 4核8G 天翼云电脑并附上实操步骤」。

因此系统设计为 **「规则初筛 → AI 语义审核 → 获取方式分级」** 三层协同管道。

## 网页热配置（推荐）

无需在 `.env` 里改配置重启容器，进入 Web 管理区 **「AI 引擎」** 页即可在线配置并立即生效：

- **模型连接**：填写任意 OpenAI 兼容端点（如 `https://api.openai.com/v1`、DeepSeek、OneAPI/NewAPI 等）、模型名与 API Key，并支持保存前先测试草稿连通性；
- **规则初筛与送审范围**：
  - 可独立开关「入口噪音预拦截」与自定义拦截词（与「订阅与屏蔽」合并为统一规则），先挡掉明显求助/拼车/二手帖，节省 Token；
  - 支持「纯白嫖专源免送 AI 直通」（Epic / Steam / GamerPower / CheapShark / ITAD / SharewareOnSale 等源经 `enforceFreebieEvidence` 复核后直接标真福利）；
  - 支持「AI 语义去重（自动）」与对比窗口小时数（6–168h），在入库审核后与推送前对跨源同事件做聚类合并；
  - 支持指定「全部启用源 / 排除指定源 / 仅审指定源」；
- **审核补充规则与偏好学习**：
  - 通过 `extraPrompt` 追加个人过滤偏好（保留内置 JSON 结构化输出口径）；
  - 支持从「我的收藏（正样本）」与「已关闭/忽略（负样本）」自动采样，让 AI 越用越懂你的口味；
- **历史库补审与零 Token 重整**：调整规则或提示词后可一键选择 `pending`（仅未审）、`recent`（最近条目重审）或 `rejected`（复核误杀条目），也可直接点击 **「重整分类 (0 Token)」** 零成本重跑规则与证据校验。

## 协议类型：Chat Completions 与 Responses

内置两套 OpenAI 协议，审核、语义去重、连通测试三处共用同一个客户端（`src/server/enrich/ai-client.ts`），不会出现「审核能用、测试报错」的错位：

- **默认（Chat Completions）**：`POST {baseUrl}/chat/completions`，携带 `temperature: 0`，兼容绝大多数中转站。
- **Responses**：`POST {baseUrl}/responses`，`instructions` 传系统提示词、`input` 传批量 JSON；不传 `temperature`（给不支持采样参数的模型留活路），只取 `output[].content[]` 里 `type=output_text` 的文本，跳过推理与工具输出；`status` 不是 `completed` 直接判失败，不会把半截结果当审核结论。

配置方式二选一：网页「AI 引擎 → 协议类型」下拉（热生效），或首次部署时用 `AI_PROTOCOL=response` 初始化。**基础地址只填到 `/v1`**，不要自己拼 `/chat/completions` 或 `/responses`。

## 云端提示词（可选）

审核口径可以放在仓库外，改完不用发版：

```bash
PROMPT_URL=https://raw.githubusercontent.com/<you>/<repo>/main/system.md
PROMPT_EXTRA_URL=https://raw.githubusercontent.com/<you>/<repo>/main/extra.md
PROMPT_SYNC_MINUTES=10   # 0 = 只在启动时同步一次
```

- 启动时同步一次，之后按 `PROMPT_SYNC_MINUTES` 轮询，请求带 `If-None-Match`，`304` 不写库
- 拉取失败、内容为空、超过 20000 字或非 `https` 时**保留上一版**，只记录 `lastError`
- 状态与手动触发：`GET /api/ai/prompt-sync` 看状态，`POST /api/ai/prompt-sync` 立即同步（均需 `ADMIN_TOKEN`）
- 自定义 `systemPrompt` 时，服务端仍会自动补上分类清单（`category` 取值与细类说明来自 `src/shared/taxonomy.ts`），提示词里不用重复写

## 提示词只做语义，硬事实由证据规则兜底

提示词管「有没有可领的对象、是不是新闻体裁、该进哪个分类」这类语义判断；形态 `kind` 出来后还会被 `src/server/enrich/index.ts` 的证据规则二次校验：仓库 URL、价格、兑换码、`（已无）/已领完`、`.ics 订阅/资源合集` 这类硬事实不会被提示词推翻。调完提示词发现个别条目仍错，改的是规则而不是提示词。

## 返回契约

AI 输出严格 JSON 数组，每条包含：

```json
{
  "index": 0,
  "keep": true,
  "kind": "freebie",
  "category": "cloud",
  "obtain": "conditional",
  "quality": 4,
  "reason": "天翼云电脑 4核8G 免费领，附教程"
}
```

- `kind` 五类有效形态：`freebie`（白嫖福利）、`deal`（特价好价/拼车/二手）、`opensource`（开源项目）、`news`（重要新闻）、`info`（行业资讯），以及拦截形态 `noise`；
- `obtain` 六级获取方式：`free`（直接白嫖）、`conditional`（需注册/实名/签到/填表）、`lottery`（抽奖）、`trial`（短期试用）、`promo`（推广引流）、`paid`（需付费）；
- `quality`（1–5 分）会自动参与最终综合评分校准；
- 返回结果还会经过 `enforceFreebieEvidence` 证据校验与来源固定分类收口，且不会覆盖管理员的单条人工纠正。详见 [分类设置与人工纠正](classification.md)。
