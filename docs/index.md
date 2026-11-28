---
layout: home

hero:
  name: 资源雷达
  text: 自托管的福利雷达站
  tagline: 从全网采集福利、好价、拼车、开源项目与新闻，规则初筛 → AI 定级 → 分频道呈现 → 按兴趣推送，一条链路走完
  image:
    src: /ui-grid.png
    alt: 资源雷达三列卡片视图
  actions:
    - theme: brand
      text: 开始部署
      link: /deploy
    - theme: alt
      text: 在线演示
      link: https://radar.zichuanlan.top
    - theme: alt
      text: 交给 AI 部署
      link: /ai-deploy

features:
  - title: 8 个兴趣频道
    details: 真福利、全部白嫖、实物福利、网盘/网课、好价、开源、重要新闻、行业资讯。切换频道自动重置不兼容的筛选条件，URL 同步状态可直链分享。
  - title: 两层正交分类
    details: 6 种内容形态（白嫖/好价/开源/新闻/资讯/噪音）× 28 个垂直领域，另有 6 级获取方式（免费/有条件/抽奖/试用/推广/付费）与证据校验兜底。
  - title: 三层高信噪比降噪
    details: 统一屏蔽词在采集入库前直接拦掉（省 AI 额度），AI 语义审核与语义去重可按需开启，支持单条人工纠正与零 Token 存量重分类。
  - title: 多路由推送
    details: 全局策略之外可配多条专题路由，各自设定形态/分类/获取方式/关键词/最高价/最低分，支持先审后推或极速抢码、夜间静默与 Webhook。
  - title: 公开站与个人隔离
    details: SITE_MODE 一键切换自部署与公开站。公开站支持 LINUX DO / GitHub 登录、邀请码、名额上限、个人隔离与个人 Bot / RSS。
  - title: 部署省心
    details: 官方镜像已发布到 Docker Hub（一条 docker run 起站），也支持源码构建；内置 SQLite WAL（Schema v32），常驻内存约 80–100 MiB。
  - title: 中英双语
    details: 界面文案全部走零依赖 i18n（中文即词典 key，非中文浏览器默认英文），顶栏/侧栏一键切换或 ?lang=en 直达。
  - title: 口径可外置
    details: 系统提示词支持从远端 URL 同步（带 ETag、失败保留上一版），调审核口径不用发版；AI 支持 Chat Completions 与 Responses 两套协议。
  - title: 交给 AI 部署
    details: 一段可复制的部署指令，Claude Code / Codex / Cursor 都能照着跑；附带 6 条可自动验证的验收清单，不靠「我觉得好了」。
---

## 它解决什么问题

自己追福利最烦的不是找不到，而是**信息太杂**：付费好价混在白嫖里、拼车帖混在新闻里、同一批内容被十几个源重复推送。

资源雷达把这条链路拆成四步，每步都能在网页端实时调优：

1. **采集** —— 116 个内置源 + 自定义 RSS + 登录态回环助手，14 路零额外请求提取封面图并统一去重
2. **初筛** —— 规则噪音预拦截 + 统一屏蔽词防火墙，明显不想要的在送 AI 之前就丢掉
3. **定级** —— AI 输出 `keep` / 形态 / 领域 / 获取方式 / 质量分 / 中文理由，叠加证据校验与人工纠正（人工 > 固定分类 > 证据校验 > 规则/AI）
4. **分发** —— 网页按 8 个频道与「列表 / 2列 / 3列」呈现，Telegram / Webhook 按专题路由推送

## 界面速览

| 工作台列表视图（8 大频道 · 高级筛选 · 兑换码复制） | 多路由推送策略（先审后推 · 专题路由 · 静默时段） |
| :---: | :---: |
| ![工作台列表视图](/ui-public.png) | ![多路由推送策略](/ui-push-panel.png) |

| AI 语义引擎（判定分布 · 语义去重 · 零 Token 重整） | 移动端响应式视图（列表 / 卡片切换 · 触控优化） |
| :---: | :---: |
| ![AI 语义引擎](/ui-ai-panel.png) | ![移动端响应式视图](/ui-mobile.png) |

## 从哪里看起

- 想直接跑起来 → [部署与运维](/deploy) · [交给 AI 一键部署](/ai-deploy)
- 要放到公网 / 开多用户 → [公网部署与安全边界](/security) · [公开站：登录与个人隔离](/accounts)
- 分类不准、想调口径 → [分类设置与人工纠正](/classification) · [AI 语义审核](/ai)
- 想知道能采哪些站 → [数据源与可达性](/data-sources)
- 想让消息主动找你 → [多路由推送系统](/push)
- 想改前端页面或查接口 → [工作台结构与数据边界](/workspace-architecture)
