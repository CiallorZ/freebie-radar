# 变更记录




## 2026-11-24 · v1.1.10

### 分类体系

- `headline` / `world` 合并进 `news`（AI 长期互串，两者描述只差国内/国际）；迁移 items 1796 条，分类 28 → 26
- 裸「源码」不再算开源项目证据：「XX 实战课程（含源码）」这类资源包不再被判 `opensource`
- `linuxdo-resource` 去掉 `fixedCategory: pan`，开源推广帖不再被强制归网盘
- 网盘频道 kind 白名单去掉 `opensource` / `news`；行业资讯频道收录 `goods`

### AI 打标

- 单条 `category`/`kind` 越界只丢这一条，不再作废整批 20 条重试（索引错位仍整批失败）
- 新增检索用 `tags`：2-4 个，去重、限 16 字，落库时排在关键词标签之前；`/api/items` 支持 `tag` 精确筛选
- 新增待复核队列：AI 判 `freebie` 但证据里没有任何可领取对象时 `status=review`，公开站隐藏，管理员侧栏处理

### 提示词

- `prompt-sync` 不再用 `If-None-Match`：raw.githubusercontent 的 ETag 不随内容变化，会永远 304，云端改了提示词拉不到；改为全量拉取 + 内容比对
- 规则新增：引流推广（留 ID/进群/私信/中转站）判噪音；社区求助与晒日常不算行业资讯；导购测评归 `goods`

### 采集

- 下线 10 个在本机出口 IP 下从未产出过条目的源（8 个 reddit + lowendtalk + cheapshark）；
  禁用后启用的 73 个源全部 `ok`

### 运维

- 新增 `docs/ops/2026-11-24-分类与源治理.md`，记录本轮运行时数据修正（约 950 条）与源下线清单

## 2026-11-24 · v1.1.9

### 云端提示词：改审核口径不用发版

- 新增 `PROMPT_URL` / `PROMPT_EXTRA_URL` / `PROMPT_SYNC_MINUTES`：启动同步一次 + 定时轮询，请求带 `If-None-Match`，304 不写库
- 拉取失败、内容为空、超过 20000 字、非 https 一律保留上一版，只记 `lastError`，不会把正在用的提示词换成空串
- 状态落 `settings.prompt_sync`，`GET /api/ai/prompt-sync` 查看、`POST` 立即同步（需 ADMIN_TOKEN）
- 自定义 `systemPrompt` 时自动补 `CATEGORY_PROMPT_LINE` / `CATEGORY_DESC_LINE`，云端文本漏写分类清单也不会让模型丢掉 `category` 取值
- 提示词源仓库独立在 [radar-prompts](https://github.com/ZiChuanLan/radar-prompts)，`.env.example` 里默认注释，避免 fork 误用上游口径

### 分类口径收紧（线上误判样本驱动）

- `QUESTION_TITLE` 原来要求「吗」在句尾，「死绝了吗，卡网都没货了」被逗号截断就漏判；放宽为「吗」后可跟标点，并补 `没货/无货/售罄/死绝/绝版/还有吗/已抢完/靠谱吗/有人知道`
- 提示词补：讨论/抱怨/库存播报无领取入口不得判 `freebie`；`reason` 只能引自原文，不许编造领取路径；实体物品一律 `category=offline`；绿色版/破解包归 `software` 不是 `opensource`
- 提示词补：社区开源推广帖（`【开源】` 前缀或「写了个/做了个 + 工具」且指向仓库）归 `opensource`/`dev`，不得判 `pan`；网盘影视即使带「资源」二字，`kind` 也只能是 `freebie`/`info`
- 源配置：`linuxdo-resource`（资源荟萃）去掉 `fixedCategory=pan`，混合版块不再把 AI 的正确分类覆盖成网盘

### 深色主题：修白底白字

- 12 处仍在用 `bg-ink-950 + text-on-solid` 的实心块（Toast、登录按钮、弹窗主按钮等）在深色主题下是白底白字，统一改用 `bg-solid`
- `border-ink-800` 是未定义的颜色类（边框一直没生效），改 `border-ink-700`；两处弹层遮罩 `bg-ink-950/25` 在深色下变白雾，改 `bg-overlay`

### 条目行内操作

- 图标顺序改为「屏蔽 / 关闭 → 打开原帖 → 收藏」，`row-actions` 右对齐，悬停出现的那两个不再挤动打开原帖与收藏的位置

## 2026-11-23 · v1.1.7

### 优先级纠正：AI 是基准，规则只做初筛与兜底

v1.1.6 把判定统一到了 `classify.ts`，但优先级还是「规则复审 AI」——AI 判过的条目会被证据闸重新裁决一遍，于是「重整分类（0 Token）」实际上等于用规则重判全库，模型的语义结论被悄悄丢掉。

现在：

- **AI 已判（`aiKeep === true`）且给出合法形态 → 直接采用**
- **只有硬矛盾才推翻**，逐条可解释：`freebie` 却明确标价 → `deal`；已撤销/维权文 → `info`；只介绍项目、没有任何可领取对象 → `opensource`；提问或报道体裁且无可领取对象 → `info` / 权威源 `news`；`deal` 却没有任何价格、促销或交易动作 → `info`；`news` 非权威源 → `info`；`opensource` 无任何项目证据（模型幻觉）→ 按证据回落；交易/拼车 + 交易证据 → `deal`
- **AI 未给结论**（未启用 / 未审 / 返回空）→ 规则兜底：结构化证据优先，其次词法
- **`aiKeep === null` 的旧 kind 不再被当作 AI 结论**——以前这正是「旧的规则结果冒充 AI」的漏洞
- **付费口径统一到 classify**：认购买动作与真实价格，「100 元到账」「16 元券」这类福利金额不再被当成售价

### 界面文案

「重整分类 (0 Token)」的说明改成它真正做的事：**补判未审条目 + 修硬矛盾，不改动 AI 已判的结论**；要按 AI 重新判请走重新审核（会消耗 token）。

### 真实库验证（4000 条 active）

- 2052 条走 AI 基线，其中仅 **63 条（3.1%）** 被硬矛盾纠正
- 1948 条未审走规则兜底，341 条与旧库结论不同

### 测试

新增「AI 是基准」用例：语义分歧保留 AI、硬矛盾纠正、未审走规则、开源幻觉回落。`pnpm test` 216/216、`pnpm typecheck` 干净、`pnpm build` 通过、`pnpm i18n:check` 1305/1309。
## 2026-11-23 · v1.1.6

### 判定层重写：从「加词表」改成「证据 + 优先级表」

v1.1.5 的修法是给三类样本各自补关键词，能过那三个样本，但换个说法就失效——这是过拟合。这一版把形态判定收进一个新层 `src/server/enrich/classify.ts`：

- **证据层**：`readEvidence()` 只产出事实，不产出结论——是否有领取证据、是否有兑换码字段、是否付费（认标题里的年付/$/年/拼车，且有免费声明时不算付费）、是否权益（对象×时效两件套）、是否项目（仓库 URL / 开源分类 / 正文开源源码 / 开发者自荐文体）、是否维权风险、是否提问或导购测评、是否已撤销
- **优先级表**：`RULES` 是一张有序表，第一条命中的规则即结论，每个结论带 `rule` 名。顺序本身就是产品定义：revoked → warning → question/导购 → claim(发放证据) → entitlement → project/自荐 → deal
- **一处裁决，处处一致**：`guessKind`（采集落库）和 `alignKindWithCategory`（AI 落库/补审/重分类/CLI）都调它，付费口径也统一成 classify 的定义，不再各算一套
- **可解释**：`explainKind(ctx)` 返回证据快照 + 命中规则，线上判定可疑时能直接定位到哪条规则，不用猜

### 用真实库验证，而不是用三个样本

从 `/opt/freebie-radar` 的生产库（23MB，4000 条 active 记录）逐条跑新判定，人工核对每类改判的方向：

- 4000 条里 536 条改判（13%），最大三类是 `freebie→info` 227、`deal→info` 181（收/溢价/导购测评归资讯）、`freebie→deal` 65（含溢价收了就标成交）、`freebie→opensource` 15（开发者自荐工具）
- 期间发现并修掉三个由真实数据暴露的错判：少数派新闻被判成开源项目、CCTV 疑问句标题被「提问」规则降级、摘要参考价把导购文带成 deal

### 测试改为性质测试，不再逐条钉文案

`tests/kind-consistency.test.ts` 现在测三条对**任何**输入都必须成立的性质：

- 幂等：把 AI 结论再喂回判定层，结果必须相同（换路径不会换结论）
- 无矛盾：分类 × 形态全网格组合不产生自相矛盾的结论
- 可解释：结构性命中必须能给出规则名，且与最终结论一致

真实样本只作为回归锚点使用，不承担泛化职责。`pnpm test` 215/215、`pnpm typecheck` 干净、`pnpm build` 通过。

### 已知未修

- 「收 X」「溢价收」这类纯交易帖有 222 条会掉资讯（既有缺陷，属于交易识别，不在本轮范围）
- 存量数据仍需零 Token 重整一次才会应用新判定：后台「数据源运维 → 重整分类」或 `cli reclassify`
## 2026-11-23 · v1.1.5

### 形态（kind）判错：错审比漏审更严重

线上三例：`【开发者自荐】BooMO` 与 `终于可以在 macOS 的快速查看里编辑了` 躺在**真福利**里（应进开源），`喜马拉雅会员7天*3` 被判成**行业资讯**（明明是能领的会员权益）。三个根因都在形态判定层：

- **「免费」压过「开源」**。`guessKind` 里 `hasOpenSource && !hasDealWord` 才判 opensource，而 `hasDealWord` 就是"有没有免费/领取词"——于是凡是免费的开源项目全被 freebie 吞掉。改为：**开发者作品/开源信号优先**（`signals.devProject`：开发者自荐、自制、自研、个人项目、仓库链接、开源、源码、MIT/Apache），只要没有明确「免费领/兑换码」证据且不涉及付费，就判 `opensource`
- **「会员时长」不算领取证据**。`contentSignals().claim` 只认「免费领 / 兑换码 / 限免」这类词，「喜马拉雅会员7天*3」一个都不命中，就一路掉到 `return guard ? "info" : "freebie"`。新增 `entitlement` 信号（会员/VIP/年卡/月卡/兑换码/激活码/礼品卡），命中即 `freebie`；带「涨价/收费/下架/停运」的报道用 `entitlementNoise` 排除，避免把「会员涨价」当成发权益
- **`specificFree` 对象词太窄**。「(YMMV) nodaroo 免费VPS 6GB内存50GB储存」只有「免费VPS」，`免费.{0,10}(游戏|软件|授权|会员|模型)` 匹配不到，规则层判成 info（全靠 AI 救回来）。补上 VPS / 主机 / 服务器 / 域名 / 空间 / 流量 / 额度
- **一致性闸收口到 `alignKindWithCategory`**：新增两条与分类无关的裁决——开源/开发者作品（无领取证据）一律 `opensource`；会员权益类被 AI 判成 `info`/`news` 时改回 `freebie`。它已经被采集落库、AI 落库、补审、重新分类、CLI 五条路径共用，不再各判一套
- **频道互斥**：`真福利` 排除 `opensource` 分类。真福利的定义是「能领到的东西」，开源项目属于「能用的项目」，归开源频道，不让同一条内容占两个频道

### 存量数据要重跑一次

规则只对**新条目**生效。已经误判的历史条目用零 Token 重整修：后台「数据源运维 → 重整分类」或 `pnpm tsx src/server/cli.ts reclassify`。它会重新走 `resolveKind` + `enforceFreebieEvidence`，把 `freebie` 的开源项目迁到 `opensource`、把 `info` 的会员权益迁回 `freebie`。

### 实测

新增 `tests/kind-consistency.test.ts` 钉住这六个真实样本（BooMO → opensource、macOS 快速查看 → opensource、喜马拉雅会员 → freebie、GitHub 学生包 → freebie 不被开源规则劫持、免费 VPS → freebie、黑五 VPS → deal，外加「会员涨价」→ info）。`pnpm test` 216/216、`pnpm typecheck` 干净、`pnpm build` 通过。
## 2026-11-23 · v1.1.4

### 深色模式

- **三态主题**：跟随系统 / 浅色 / 深色，选择存 `radar_theme`，落到 `<html data-theme>`；侧栏与移动端顶栏两个切换按钮共用 `lib/theme.ts` 的模块级 store，不会各翻各的
- **只换语义 token，组件不写两遍**：`styles.css` 的 `html[data-theme="dark"]` 覆盖 `--color-canvas / surface / ink-* / deal / code / alert` 一组取值，页面结构完全不动。规避了 `dark:` 变体在 60+ 个组件里翻倍
- **与「文字深浅」解耦的实心色**：新增 `--color-solid` / `--color-on-solid` / `--color-knob` / `--color-overlay` / `--color-accent-solid` / `--color-deal-solid` / `--color-alert-solid`。此前主按钮统一是 `bg-ink-950 text-white`，而 `ink-950` 在深色下必须是接近白的文字色，直接翻转会得到白底白字；现在按钮底色单独走 `solid`（深色主题下翻成靛蓝），白字与白色开关滑块在两种主题都成立
- **清掉写死的调色板**：4 个文件里的 `text-amber-900` / `bg-emerald-50` / `bg-red-50` 等换成 token。这些颜色不随主题翻转，深色下会变成深棕字压深棕底的不可读组合
- **`color-scheme` 跟着切**：浅色 `only light`、深色 `only dark`，表单控件与滚动条一起换；仍然拒绝安卓 Chrome 的自动深色反相

### 相对时间不再停在「刚刚」

- **根因一：时钟不走**。`timeAgo()` 在渲染时取 `Date.now()`，但列表不会自己重渲染，页面开着多久都显示打开那一刻。新增 `lib/clock.ts`（模块级 30 秒 ticker + `useSyncExternalStore`）与 `<RelativeTime>` 小组件：只有时间标签重渲染，431 行列表不会每 30 秒整体重画；标签页切回来时补一次
- **根因二：未来时间被算成「刚刚」**。Epic「即将免费」把开卖时间写进 `publishedAt`，负差值直接落进 `m < 1` 分支。现在未来时间显示「即将开始 / N 小时后开始 / N 天后开始」
- **时间列放宽**：`w-14` → `w-[72px]` 且 `whitespace-nowrap`，中文「3 天后开始」不会再折成两行

### 其他修正

- 左轨数据源分组名与来源名补 `min-w-0` / `truncate`，超长名称不再横向顶出轨道
- 工具栏策略摘要允许收缩并省略，文字变长时不会把右侧计数挤重叠


## 2026-11-23 · v1.1.0

### 工作台 v2：URL 即状态、列表优先、移动端一屏可用

- **页面从「一长串堆叠面板」改成双栏工作台**：左侧固定轨道（快捷视图 + 数据源树 + 分组计数），右侧单列内容区。此前所有筛选、统计、来源、分类胶囊、说明卡全叠在内容上方，首屏 60% 是 chrome，431 条列表要滚很久才看到第三条；现在首屏全部让给条目
- **URL 即筛选状态**：`src/web/src/lib/feedQuery.ts` 统一读写 `preset / q / source / category / filterLang / sort / range / price / score / obtain / kind / unread`，`writeFeedSearch` 只增删自己拥有的键，保留 `login_*`、`lang`、`workspace` 等外部参数。显式导航（切页、切作用域）走 `pushState`，同步筛选走 `replaceState`，筛选可直链分享且不堆历史
- **频道口径收口到 `src/shared/channel-query.ts`**：`applyChannelQuery` 前后端共用——网页、导出、RSS、`cli diagnose` 不再各抄一份默认值；`feedPolicyLabels` 按实际生效参数生成说明（「审核保留 / 未过期 / 近 7 天 / 直接或有条件领取」），不再把「审核保留」说成「免费」
- **列表行重做**：来源改为恒定色条（同一来源永远同色，长列表靠它做视觉锚点）+ 来源名 + 分类 + 截止时间在一条 12px 副行里；兑换码胶囊、快捷操作（打开 / 收藏 / 屏蔽 / 忽略）收进行尾并按需 hover 显示；跨源同福利折叠成「N 个来源」可展开
- **三档视图**：列表 / 2 列 / 3 列，`< 768px` 自动收成「列表 / 卡片」两档并隐藏三列（此前 390px 宽下三个按钮全渲染，点了直接横向溢出，`scrollWidth 414 > 390`）
- **移动端触控与布局**：筛选条、视图切换、更多菜单统一 44px 最小触控高度，行内操作按钮 36px；数据源树与快捷视图折进「筛选」抽屉；筛选条与工具栏合并为一整行，移动端首屏顶栏高度 −37%
- **详情抽屉**：抽屉加 `outline-none` 与明确的焦点落点，键盘可关闭，长正文改 `max-h` + 渐隐 + 「展开全文」，不再一屏塞满整篇摘要
- **“其它 / 其它资讯”不再挂在每一行上**：兜底分类是噪音，只在确实非默认时才显示；分类徽章改为按 `rawCategoryLabel` 判空，英文界面下不再因为翻译后的字面量不等于「其它」而误显示

### 分类证据校验与人工纠正优先级

- **新增 `enforceFreebieEvidence` 单一收口**（`src/server/enrich/evidence.ts`）：采集/重采、同步与异步审核、历史补审、零 Token 重整、`cli reclassify/obtain` 全部复用它。此前各路径各判一次的后果是——付费预告、更新公告、"某游戏免费更新了新地图"这类条目在网页上被标成白嫖
- **优先级固定为：人工纠正 > 来源固定分类 > 证据校验 > 规则 / AI**：新增 `item_classification_overrides` 表（Schema v31），并用 SQLite 触发器兜住 CLI、后台重审等所有写入路径，人工改过的 `category`/`kind` 不会再被任何自动流程覆盖
- **人工纠正只锁分类与形态**：`ai_keep=false`（模型判为不保留）不会被人工分类取消；来源 `fixedCategory` 是领域路由约束，不是「免费」或「审核通过」的凭证
- **Schema v32**：清理中性分类里被误判进真福利的消费测评文，以及把 `freebie` 落进资讯类分类的历史条目一律降级为 `info`

### AI 语义去重与多路由推送

- **AI 语义去重（`enrich/ai-dedup.ts`）**：审核落库与后台补审后各跑一次 `dedupeKeptItemsWithAi`，跨源同一事件（Epic 一条福利被四个人转发、B 站会员三个不同措辞）合并成一行；设置页可开关并配置对比窗口（6–168h）。此前按标题精确匹配去重，同一福利换个措辞就活成两行
- **多路由推送重构**：全局策略 + `routes[]` 专题路由，每条独立设形态 / 分类 / 获取方式 / 关键词 / 最高价 / 最低分 / 即时或攒批 / 消息头前缀；新增 `pushTiming`（先审后推 / 抢码优先）与 `aiFallbackMode`（`strict` / `rule_fallback` / `ignore_ai`）
- **攒批发出前二次回查数据库**：入队时合格、发出前已被屏蔽 / 改分类 / 过期 / 命中新增屏蔽词的条目不再误推
- **静默时段按时区算**：`inQuietHoursZoned()` 用 `Intl.DateTimeFormat(..., { timeZone })`，容器 UTC 不再把北京时间白天静音

### 文档站与三语 README

- **VitePress 文档站**（`docs/`，GitHub Actions 发布到 Pages）：导航重组为「上手与运维 / 分类与治理 / 采集与推送 / 界面与架构」，`push.md` 从早期重构记录升级为当前多路由推送的完整说明，`ai.md` 补齐 `kind` 契约、语义去重与证据校验，`deploy.md` / `accounts.md` / `ai-deploy.md` 的入口路径同步为「数据源运维」「站点设置」
- **三语 README**（`README.md` / `README.en.md` / `README.ja.md`）：数字全部按源码重新核对——116 个内置源（默认启用 67）、28 个分类、Schema v32、14 路封面图提取；补 `src/shared` 目录、完整 CLI 清单与 `docs/` 索引
- **截图重拍**：`docs/ui-public.png` / `ui-grid.png` / `ui-push-panel.png` / `ui-ai-panel.png` / `ui-mobile.png` 全部换成当前界面（含新增移动端视图），拍摄于临时空库 + 合成样例数据，不含真实账号与个人数据

### Docker Hub 官方镜像与 CI 发布

- **镜像发布**：`zichuanlan/freebie-radar`，`latest` 跟主干、`v*` 打版本号（`v1.1.3`）、并发一个 git 短 SHA（`19eb371`），生产环境建议固定版本标签以便回滚
- **发布方式改到 CI**：新增 `.github/workflows/docker.yml`，在 tag / 主干推送时用 buildx 构建并推送，带 gha 层缓存；未配置 `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` 时整条 job 绿色跳过，不会把主干刷红。本地出不了镜像的原因写在 workflow 注释里：本机 `registry-1.docker.io` 连接被重置，andnode 只有 1.9G 内存且 swap 已占 1.8G，构建会挤掉线上服务
- **一条命令起站**：README 三语与 `docs/deploy.md` 都给出不 clone、不构建的 `docker run` 用法（挂 `/data` 卷、`-e ADMIN_TOKEN`），并说明「用镜像升级」`docker compose pull && docker compose up -d` 与「从源码升级」`git pull && docker compose up -d --build` 两条路径
- **compose 支持按需拉取**：`docker-compose.yml` 的镜像名改为 `${RADAR_IMAGE:-zichuanlan/freebie-radar:latest}`，`.env.example` 新增 `RADAR_IMAGE`；`build: .` 保留，本地缺失时 `up` 仍会自动构建
- **可信度信号**：README 徽章从静态 `Docker-Ready` 换成 Docker Hub 的 pulls 与镜像体积实时徽章
- **版本号对齐**：`package.json` 1.1.0 → 1.1.3（`/health` 的 `version` 取自它）。发布过程中打出过 `v1.1.1`（纯文档）与 `v1.1.2`（CI 工作流）两个中间 tag，镜像内容与 `v1.1.3` 一致，仅 `/health` 上报的版本号不同
### 实测

`pnpm test` 208/208、`pnpm typecheck` 干净、`pnpm build` 通过、`pnpm docs:build` 通过、`pnpm i18n:check` 1304 条中文文案已进词典 1300 条（剩 4 条刻意不翻：语言自称、dev 缺词告警、分类抽样样例标题、推送预设关键词「年付」）。Playwright 逐档截图核验 1440 / 1024 / 390 三档无横向溢出，桌面列表 / 2 列 / 3 列与移动端列表 / 卡片均可正常渲染。

## 2026-11-22

### 中英双语界面、三语 README 与「交给 AI 部署」

- **零依赖 i18n（`src/web/src/lib/i18n.ts`）**：约定「中文原文即词典 key」——`t("真福利精选")` 在中文下原样返回，英文下查 `lib/i18n/en/*.ts` 分片词典，查不到回落中文并在 dev 下告警缺词。不引 i18next 之类的运行时：2100+ 条文案若改语义 key，要先发明 2100 个名字，改造量与出错面都翻倍，而中文当 key 让源码始终可读、漏翻只退化成中文而不是白屏
- **带变量用 `{name}` 占位**：模板字符串 `共 ${n} 条` → `t("共 {n} 条", { n })`；中文侧同样替换占位，中英只有一套拼接逻辑
- **切换语言走整页重载**：`setLang()` 只写 `localStorage` + `location.reload()`。频道表、分类表、页签表这些常量在模块导入时求值，重载是唯一不引入订阅机制就能让它们换语言的做法（切换极低频，代价可忽略）
- **入口与默认值**：桌面侧栏第二行与移动端品牌行各一个 `中/EN` 按钮；`?lang=en` 可直接进英文界面并记住选择；`<html lang>`、`document.title` 跟着切；非中文浏览器首次访问默认英文
- **全量覆盖 18 个前端模块**：App / ItemView / PushPanel / OpsPanel / AiPanel / UserPushPanel / SiteAdminPanel / RulesPanel / ClassificationPanel / ItemClassificationEditor / AuthModal / RssModal / WelcomeModal / HotPanel / DigestPanel / AdminGate / lib/sources / lib/session，外加 `shared/taxonomy.ts` 的 28 个分类 + 分类说明、6 形态、6 获取方式、8 频道、5 分组、20 个资讯栏目名，以及后台可编辑的入站公告（`ob.title` / `ob.content` 在渲染处过 `t()`）
- **不翻译的边界**：参与 `===` / `includes` / 正则 的字符串（推送预设关键词「黑五」「年付」、分类 key、来源 id、API 路径、localStorage key）保留中文原文；被遮蔽的 `t` 局部变量（`.map((t) => …)`、`const t = setInterval`、`const t = new Date()`）机械改名。**数据源名称与条目标题/摘要属于采集内容，保持原语言**——聚合内容的语言不该被 UI 语言篡改
- **验收工具 `pnpm i18n:check`**（`scripts/i18n-check.mjs`）：扫 JSX 文本节点与字符串字面量，和词典 key 比对，输出逐文件未翻译清单与覆盖率
- **README 三语**：`README.md` / `README.en.md` / 新增 `README.ja.md`，顶部语言切换互链；英文版补齐 `SITE_MODE` 双形态对照、外部工具（Epic 领取器）、登录态采集、文档索引与免责声明等此前缺失章节
- **交给 AI 部署**：新增 `docs/ai-deploy.md`（中英双语可复制 Prompt + 6 条可自动验证的验收清单 + 常见失败对策 + 部署后备份升级说明），三语 README 与文档站首页同步入口
- 实测：`pnpm typecheck` 干净、`pnpm build` 通过（首屏 `index` 218KB / gzip 76KB）、`pnpm test` 130/130、`pnpm docs:build` 通过；`pnpm i18n:check` 1276 条中文文案已进词典 1272 条（**剩 4 条刻意不翻**：语言自称「简体中文」、dev 缺词告警、分类抽样样例标题、推送预设关键词「年付」）；Playwright 对比 `/?lang=en` 与 `/?lang=zh`：`<html lang>`、标题、频道/侧栏/筛选项/分类胶囊全部随语言切换，`push`/`ops`/`ai` 三个管理面板英文下无 page error

## 2026-11-16

### 实地福利收紧：先得是福利，再谈实地

- **根因一：AI 判对的分类被丢掉了**。采集落库（`collectors/index.ts`）只把 AI 的 `category` 拿去算 `kind`，写进 `items.category` 的始终是关键词规则结果；线上 51 条 `offline` 里有 42 条 AI 给的是 `tech` / `news` / `goods` / `headline`，全被规则覆盖。现在 AI 分类优先落库，规则只在 AI 没给时兜底
- **根因二：`offline` 规则只认地点词**。「附近」「现场」「门店」单独命中就能进实地福利，于是「杭州附近的兄弟有吗…一起免费玩」这类闲聊、防火玻璃抽检通报都被收进来。规则改为 `require` 必须同时出现领取动作（免费领 / 领取 / 免费送 / 派样 / 试吃…），并 `exclude` 抽检、不合格、通报、求租、租房、租房组队这类资讯与求助
- **统一收口 `demoteOfflineCategory()`**：`offline` 只接受 `kind ∈ {freebie, deal}`；`news` / `info` / `noise` 一律降级。enrich、AI 审核落库（`ai-queue`）、补审（`ai-admin`）、采集落库、`reclassify` 五处共用同一函数，不再各写一套
- **`reclassify` 优先采用 AI 分类**：后台「零 Token 重分类」以前对已审核条目只保留库里的旧分类，现在先读 `ai.category`，再退回库值 / 规则值
- **Schema v29**：把 `offline` 里 kind 为 `news` / `info` / `noise` 的条目和历史误判（不合格 / 抽检 / 通报 / 求租 / 租房 / 记者 / 发布会 / 峰会）移出
- **口径收紧到「先福利，再实地」**：`isOfflineWorthy()` 要求 `kind=freebie` + 线下场景词（到店/门店/现场/商场/专柜/快闪/自提/打卡/试吃/博览/市集…）+ 领取动作 + 中文文本。好价（deal）、全英文的海外线上促销（如 Walgreens 照片卡、DQ 2 for $6）一律不进
- 实测：`pnpm test` 90/90、`pnpm typecheck` 干净；本地 448 条库 `offline` 2 → 1（南京「零元面馆」排队免费领素面），二次运行 changed=0
- 线上（andnode，8092 条）重跑 `reclassify`：`offline` 51 → 1，只剩「海口博博会，河北博物院礼品免费送」；AI 判为 `tech`/`news`/`goods` 的 42 条随重分类归位，`/api/items?category=offline` 返回 1 条，前端「实地福利」频道显示 1 条

### 移动端顶栏瘦身、首屏体积与接口压缩

- **拒绝安卓自动深色**：`styles.css` 的 `color-scheme` 由 `light` 改为 `only light`，并在 `index.html` 补 `<meta name="color-scheme" content="only light">`。此前手机开深色模式时 Chrome 的「自动深色」会把整站反相成纯黑底 + 灰描边，浅色设计被彻底毁掉；CSS 里只写 `light` 不足以拒绝自动反相，必须是 `only light`（实测 computed `light only` 后停止反相）
- **移动端顶栏 9 行 → 5 行**：说明/RSS/GitHub/导出/刷新收进品牌行（纯图标），账号并入 Tab 行右端，场景与数据源（快捷视图 + 数据源树）折进「筛选」面板，筛选条件整条按钮与视图切换两键各合成一个图标，统计并进分类行右端；顶栏高度 320px → 203px（−37%）
- **GitHub 入口**：品牌行与桌面侧栏新增 GitHub 图标，新窗口跳 `https://github.com/ZiChuanLan/freebie-radar`
- **面板按需加载**：`DigestPanel` / `HotPanel` / `RulesPanel` / `PushPanel` / `AiPanel` / `OpsPanel` / `SiteAdminPanel` / `UserPushPanel` 改 `lazy` + `Suspense`，React 单独成 vendor chunk（`vite.config.ts` 的 `manualChunks`）。首屏 JS 528KB → 334KB（未压缩），首次进入管理区才拉对应面板
- **接口压缩**：服务端加 `compress()` 中间件（此前 `/api/items?limit=100` 77KB 明文裸传）。实测该接口 77218 → 7197 字节，整页传输 648KB → 123KB
- **实测**（Playwright 390×844，4x CPU 降速）：FCP 472ms → 372ms；滚动帧 p95 7.8ms、无 >50ms 掉帧；标签页来回切 20 轮 DOM 节点稳定 840、堆内存锯齿不增长（无泄漏）；`pnpm typecheck`、`pnpm test` 87/87、`vite build` 均通过
### 多登录渠道、名额上限与 Webhook 推送

- **GitHub 登录**：新增 `/api/auth/github/login|callback`，与 LINUX DO 共用一套准入收尾 `finishLogin()`（登录开关 / 名额上限 / 邀请码 / 封禁 / 老用户直登），避免两套逻辑跑偏；GitHub 无 `trust_level` 概念，最低信任等级门槛对它不生效（按 0 处理）；内部用负数 `linuxdo_id` 做命名空间，两个渠道 id 互不冲突。凭据：`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_REDIRECT_URI` / `GITHUB_PROXY`
- **注册名额上限**：`AccessControl.maxUsers`（0 = 不限）。满了只挡新注册，老用户照常登录；命中时回调跳 `/#quota-full`、接口返回「站点名额已满（x/y）」。后台「访问控制」可直接改
- **Webhook 推送渠道**：个人推送新增 `deliverVia`（`telegram` / `webhook`）+ `webhookUrl` + `webhookSecret`，投递 POST JSON `{source, text, sentAt}` 并带可选 `X-Radar-Secret` 头；不需要 Bot Token 即可启用，个人日报与测试消息同样走该渠道。QQ 官方 Bot 无主动推送通道（只能带 `msg_id` 被动回复），改用 NapCat / Lagrange 的 OneBot HTTP 接口接这一层
- **开放注册不再显示邀请码**：登录弹窗里的邀请码输入只在 `registrationMode=invite` 时渲染，开放注册下整块隐藏
- **本地模拟登录遵守真实准入**：`AUTH_DEV_MOCK` 的 Alice/Bob 在邀请码模式下同样返回 `needInvite` 并弹补码框，不再无条件建号
- **测试可重复性**：测试文件头部显式清空 `ADMIN_TOKEN` 并固定 `SITE_MODE=selfhost`，避免本机 `.env` 配了公开站/管理令牌后测试集体 401/403
- 实测：个人 Webhook 端到端（本地接收端收到 `POST /hook`、`X-Radar-Secret: s3cret`、正文含测试消息）；名额上限 1 时新用户注册被拒、老用户不受影响；`pnpm typecheck` 干净，`pnpm test` 87/87
## 2026-11-15

### 公开站：LINUX DO 登录、个人状态隔离、个人 Bot 推送与 RSS

- **站点双模式**：新增 `SITE_MODE`（`auto` / `selfhost` / `public`）。`selfhost` 完全保持旧的全局行为；`public` 下公共内容（`items` / `sources` / `digests`）只读共享，个人状态按登录用户隔离
- **公开站个人隔离**：新增 `users` / `sessions` / `user_item_states` / `user_block_rules` / `user_subscriptions`（Schema v28）；`/api/items`、`/api/stats`、条目详情、日报改用自包含 `EXISTS` 子查询按 `user_id` 过滤（`merge=1` 的窗口函数子查询拿不到外层 JOIN 别名，不这么写会直接报错）
- **未登录访客零副作用**：公开站访客的「不想看 / 收藏 / 已读 / 快捷屏蔽」只写浏览器 `localStorage`，不发请求；顶栏显示本机偏好计数，登录后可一键合并到账号
- **LINUX DO Connect OAuth2 登录**：`/api/auth/linuxdo/login|callback`，CSRF `state` 与预填邀请码一起签名存短期 Cookie；校验 `active` / `silenced` / `trust_level`；`/api/auth/me`、`/api/site/bootstrap` 供前端取身份与站点状态；非生产环境可开 `AUTH_DEV_MOCK` 用 Alice/Bob 双账号验证隔离
- **权限严格正交**：管理区只认 `ADMIN_TOKEN`（定长摘要比对），**OAuth 登录不构成任何管理权限**；公开站未配 `ADMIN_TOKEN` 时管理写接口直接 403 锁定，不再像旧版那样无密码全开
- **登录开关与邀请码**：后台可热改「关闭登录 / 开放注册 / 邀请码注册 / 停止新注册」与最低信任等级；邀请码支持单次/多次、过期时间、停用、核销记录，核销走 `BEGIN IMMEDIATE` + 条件 `UPDATE`，并发不会超发；老用户始终免码登录，新用户可先登录再补码（10 分钟签名凭证）
- **个人 Telegram Bot**：登录用户绑定自己的 Bot Token（AES-256-GCM 加密落库，接口只回打码值）+ Chat ID，支持 `getUpdates` 一键探测 Chat ID、发测试消息、规则试算、立即冲刷；个人推送复用同一套过滤/攒批/免打扰引擎但独立去重与限流，个人上限受 `USER_PUSH_MAX_PER_HOUR` / `USER_PUSH_MAX_PER_INSTANT` 夹紧，连续 3 次发送失败自动停用
- **个人推送不依赖全局 Bot**：全局没配 `TELEGRAM_BOT_TOKEN` 时，只要有人开了个人推送，采集后仍会跑「AI 一审 → 派发」链路（含后台补审通过后的二次派发）
- **RSS 2.0 输出**：`/rss.xml`（含 `/rss/api` 别名外的 `/api/rss`）支持 `preset`/`kind`/`category`/`source`/`obtain`/`minScore`/`search`/`limit` 等筛选，带 `ETag` 与 304；`/rss/u/:token.xml` 是个人专属源，自动排除个人关闭与个人屏蔽词，支持 `?mode=push`（按个人推送规则）与 `?mode=subs`（只看关注词）
- **入站提示**：`settings.onboarding` 可热改标题/正文/引导卡片，按版本号记一次；站长「保存并重新弹出」时版本自增，所有访客下次进站重新看到
- **版本检测与一键更新**：`/api/admin/overview|update/check|update/run|update/status`；Git 源码环境支持「脏工作区拒绝 → SQLite `VACUUM INTO` 备份 → `git pull --ff-only` → install/build → 重启」，容器环境如实显示边界（Webhook 触发或复制宿主机命令），`/health` 增补 `commit` 供前端判断新版本是否真的起来了
- **清理与 AI 反馈防污染**：数据保留策略删除条目时排除「被任意登录用户收藏」的条目；AI 提示词反馈只统计全局标记，普通用户操作不会污染全站审核口径
- **接口健壮性**：`/api/ingest` 对缺失 `externalId` 的回传条目回退用 URL 兜底（此前会把 `undefined` 绑进 SQLite 直接 500）
- 本地端到端实测 51 项全通过（公开站隔离 / 权限正交 / 邀请码 / RSS / 个人 Bot 打码 / 公告热更新 / 关闭登录），另单独跑 `SITE_MODE=selfhost` 回归确认旧部署行为不变；`pnpm typecheck`、`pnpm test`（69 例）、`vite build` 均通过

### 国内源补强：NGA 优惠版（登录态）+ 5 个中文主机圈促销源

- 新增 `nga` 采集器（`src/server/collectors/nga.ts`）：NGA 已全面改为登录可见，实测所有镜像域名对访客返回 403「15:访客不能直接访问」（`guestJs` 时间戳无效），因此走 HTTP + 托管 Cookie（`ngaPassportUid` / `ngaPassportCid`），主通道 GBK HTML 列表页、备通道 `__output=11` JSON
- Cookie 托管新增 `nga` 站点（`.nga.cn`），且 NGA 不需要 VPS 无头执行器即可进入调度；运维台的 Cookie 卡片由 3 张扩到 4 张
- 新增默认源 `nga-deals` → **fid=570 优惠信息购物指南**（国内羊毛/优惠主版块），间隔 600s
- 用免登录的 `nuke.php?__lib=view_privilege` 枚举出 NGA 版块地图：570 挂在「杂谈 > 消费电子 IT新闻 (436)」下，同父版块还有 498 二手交易、613 分享活动买家互助（拼车）；据此新增 `nga-carpool`（613，`carpool`）与 `nga-trade`（498，`trade`）两个源，采集器支持 `categoryHint` 透传
- 水区 `-7 网事杂谈` 不接入：福利帖占比低、需注册用户且只看 144 小时内新帖，噪声与配额不划算
- 新增 `bili` 采集器 + 源 `bili-freebies`：B 站关键词搜索（`wbi` 签名算法免登录可用，`w_rid` 由 nav 的 img_key/sub_key 按固定 MIXIN 表重排后 md5），主通道 `wbi/search/type`、降级 `search/all/v2`；实测 4 关键词一轮入库 44 条（freebie 40 / deal 4）
- B 站过滤策略：标题白名单（免费/白嫖/喜加一/限免/兑换码…）只看**标题**不看简介（否则「全12集」影视剧集会混入），排除词看标题+简介；同批次相似标题合并要求「跨 UP + Jaccard ≥ 0.7」，同 UP 的周报系列（实测相似度仅 0.39-0.47）全部保留
- 新增 `tests/bili.test.ts`（6 例）：wbi 签名格式、条目映射、关键词与排除词过滤、跨 UP 合并与同 UP 保留、legacy 降级、未配置 keywords 报错
- 新增 `weibo` 采集器 + 源 `weibo-freebies`（**默认关闭**）：微博没有可用 RSS（RSSHub 的 weibo 路由公共实例实测全挂：rsshub.app 连不上、rssforever 503、shab.fun 连不上），改走 PC 端 `ajax/statuses/search`（需 `SUB` cookie）与 `ajax/statuses/mymblog`（盯人）
- 微博实测噪声过高：3 关键词 60 条 → 同文案合并后 25 条，但擦边图包（81 分）、手游私服、「白嫖奶茶教程」刷屏、新闻误入占多数；采集器已带白名单/排除词（含擦边与私服词）与同文案指纹合并，源仍默认关闭，建议改用 `uids` 盯博主的模式
- Cookie 托管新增 `weibo` 站点（`.weibo.com`，鉴权字段 `SUB`/`SUBP`/`SCF`），与 NGA 一样不需要 VPS 无头执行器；运维台 Cookie 卡片 4 → 5 张
- NGA 实测打通并修正解析：真实列表页用**单引号**属性（`href='/read.php?tid=…' class='topic'`），置顶/版规帖在 `#toptopics` 里且无 `topic` 类 —— 改为「只取带 `class='topic'` 的锚点」后，570/613/498 分别抓到 36/35/40 条，零噪声置顶帖
- 新增 `tests/weibo.test.ts`（6 例）：条目映射、标题切分兜底、白名单与擦边排除、同文案合并留互动最高、盯人模式与降级原因、未配置 Cookie/关键词报错
- 新增 5 个中文主机圈促销源（RSS 直连、零配置、实测入库 60 条）：VPS精选网 / 老左博客 / VEIDC / VPS 侦探 / 搬瓦工中文网，均落 `vps` 分类 + `deal` 形态
- 实测否决并记录：52pojie 全站 RSS 为破解教程与求资源混排、福利经验区 `fid=66` 未开 RSS；卡饭无福利版块；恩山/远景 JS 反爬；贴吧 403；豆瓣小组 RSS 已停；值得买白菜党 404；酷安/券妈妈/TapTap 为签名或 JS 壳 —— 详见 `docs/data-sources.md` 第 9 节
- 新增 `tests/nga.test.ts`（5 例）：HTML/JSON 双通道解析、Cookie 解析域、调度判定、未配置 Cookie 的明确报错、请求头携带登录态

### 分类口径单一化：主页 / 推送规则 / 数据源运维三处对齐

- 新增 `src/shared/taxonomy.ts` 作为分类（27 小类 + 5 大类分组）、内容形态（kind）、获取方式（obtain）、频道（preset）的唯一定义源，服务端与前端共同 import
- 消除 5 处重复清单：enrich 关键词规则、推送白名单校验、AI 提示词、前端 label 表、数据源运维下拉；以后加分类只改一个文件
- 修掉 AI 提示词里两份硬编码的「分类 category 只能是」，且旧的那份缺 `pan` / `course`，导致网盘、网课类内容被 AI 判成其它分类
- 推送规则：分类白名单按大类分组展示，并支持一键套用主页频道（真福利 / 全部白嫖 / 网盘网课 / 好价 / 开源 / 重要新闻 / 行业资讯）；多频道路由编辑器同步
- 数据源运维：分类下拉从 13 项补全到 26 项并按大类分组，RSS 源支持多 feed 逐条编辑（地址 / 条数 / 分类 / 用途 / 标题关键词），源列表新增「分类口径」列
- 新增 `GET /api/taxonomy` 供前端与第三方客户端渲染；`POST/PATCH /api/sources` 校验 `kindHint` / `categoryHint`，非法值直接 400，不再静默忽略
- 新增分类 `offline`（实地福利）：线下门店 / 快闪 / 商场现场领取的实物福利，从「实物/优惠」里拆出来；关键词规则带新闻排除（记者/直播/发布会等），Schema v27 迁移历史条目
- 「实地福利」独立成主页频道，不再混进真福利；频道定义新增 `exclude`，真福利同时排除网盘 / 网课 / 实地福利，主页查询与分类胶囊都按同一份设置算
- 主页快捷分类胶囊只挂真的有内容的分类（外加已选中的），数量上限 8 → 10，不再出现点了没结果的 0 条分类

## 2026-11-14

### 多兴趣频道、21 类目录与品牌升级（「资源雷达」）

- 引入 `kind`（`freebie` / `deal` / `opensource` / `info` / `noise`）与 `ai_quality`（Schema v15–v17），解耦低噪内容与必须免费白嫖
- 默认首页「真福利精选」严格锁定 AI 验真 `freebie`（`free` + `conditional`），并列开放「黑五/好价」「开源项目」「新闻资讯」频道
- 领域分类从 11 类扩至 21 类：新增 `vps`、`carpool`（拼车/合租）、`trade`（二手/出鸡）、`design`、`dev`、`security`、`hardware`、`headline`（时政/要闻）、`finance`（财经/商业）、`news`
- `/api/stats` 支持按当前频道过滤实时计数，前端按频道显示专属下级分类集合，切换频道自动清理不兼容筛选项
- 新增「重整分类 (0 Token)」接口与按钮，零 AI 成本将历史 `other` 存量条目按最新规则归位

### 图文卡片布局、多路由推送与统一屏蔽词

- 新增「紧凑列表 / 2列卡片 / 3列卡片」三种布局，10 路采集器零额外请求提取封面图（`image_url`）
- 推送引擎支持可视化多专题路由编辑器与攒批/预览路由标签，默认白嫖推送保持 `kinds=['freebie']`
- 将 AI 入口自定义噪音词合并入全局 `block_rules`，采集与补审送 AI 前自动跳过命中条目省额度

## 2026-11-12

### 获取方式分级（obtain）

- 新增独立于价格的 `obtain` 维度：`free` / `conditional` / `lottery` / `trial` / `promo` / `paid`
- 抽奖、试用、推广、需付费从「真福利精选」「完全白嫖」和 Telegram 推送中隔离出去
- AI 提示词加入 obtain 判定，并用关键词规则兜底旧数据
- 左栏新增「获取方式」筛选，条目加彩色徽章
- 修复 `unexpired` 只看 `expires_at` 导致无截止时间的老帖长期混入真福利（改为发布时间保鲜期 + 截止时间双条件）
- 修复 `priceAllowed` 让 `is_free=1` 盖过 AI 的 `paid` 判定
- 性能：拆开 `OR` + `COALESCE` 复合条件并加表达式索引 `idx_items_effective_time`，列表从 8-13 秒回到 1-2 秒

### AI 引擎页

- 端点、模型、Key、每轮送审上限、自定义提示词全部可在网页修改，改完立即生效
- 新增连通性测试（固定 3 条样本）与历史补审
- 判定分布与最近判定样本可视化
- 提示词收紧：软件版本发布、开源项目介绍、技术教程、评测对比明确判为非福利

### 数据源

- 关闭 `v2ex-promotions`：该节点 24 条里 9 条被判福利，实际全是代理/IP/中转服务商的引流帖

### 工程化

- 清理 66 个一次性探针脚本与 18 张过期截图
- 诊断能力收敛进 `cli.ts diagnose` / `cli.ts obtain`
- 补齐 README、LICENSE、CI

## 2026-11-11

- 源数量扩到 57，新增 CheapShark、IsThereAnyDeal、GG.deals、Bluesky 游戏大号、TG 频道等
- UI 重构为六个标签页，新增屏蔽词防火墙与数据源运维面板
- 推送重建为三层分流（立即单发 / 攒批 / 只入库），加入静默时段时区修正与跨源标题去重
- 接入 AI 二审，历史全量回审：1979 条里 1672 条判定并非福利

## 2026-11-10

- 时效性优化：分源采集间隔（热门源 90 秒）、采集后即时推送、兑换码提取、正文快照
- 新增「我能付多少」价格上限筛选

## 2026-11-09

- 首个可用版本：SQLite 去重、Web 站、Docker 部署
- 接入知乎 / 小红书 / 小黑盒的本机登录态采集与回传接口
