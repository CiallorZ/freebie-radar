# 部署与运维指南

> 公网上线先阅读 [安全边界与管理入口隔离](security.md)。当前 Docker 默认只向宿主机回环地址发布端口；生产环境必须设置 `ADMIN_TOKEN`。

## Docker Compose 一键部署（推荐）

本项目使用 `node:24-alpine` 单容器运行（成品镜像 ~340 MB），内置 Node.js 原生 `node:sqlite`（WAL 模式，自动增量迁移至 Schema v32），无需外接 PostgreSQL / Redis，且设置了 V8 堆与 SQLite 缓存限制，主服务容器实测常驻内存约 **80–100 MiB**。

### 用官方镜像（不构建）

镜像已发布到 Docker Hub：`zichuanlan/freebie-radar`。`latest` 跟随最新构建，同时按 GitHub Release 打 `v1.1.4` 这类版本标签、按构建提交打 git 短 SHA 标签（如 `19eb371`），生产环境建议固定版本标签。

```bash
# 最省事：不 clone、不构建
docker run -d --name radar --restart unless-stopped \
  -p 127.0.0.1:8788:8788 \
  -v radar-data:/data \
  -e TZ=Asia/Shanghai \
  -e ADMIN_TOKEN=<24 位随机串> \
  zichuanlan/freebie-radar:latest
```

用 compose 管理则把镜像版本写进 `.env`，`docker compose pull` 只拉取、不构建：

```bash
git clone https://github.com/ZiChuanLan/freebie-radar.git
cd freebie-radar
cp .env.example .env
# 可选：固定版本而非 latest（默认 zichuanlan/freebie-radar:latest）
# echo "RADAR_IMAGE=zichuanlan/freebie-radar:v1.1.4" >> .env
docker compose pull
docker compose up -d
```

`docker compose` 里 `build: .` 与 `image:` 同时存在：镜像已在本地就用本地，缺失时 `up` 会自动构建；要强制按源码重建用 `docker compose up -d --build`。

### 从源码构建

```bash
git clone https://github.com/ZiChuanLan/freebie-radar.git
cd freebie-radar

# 可选：复制并编辑环境变量（配置 ADMIN_TOKEN / Telegram 推送 / 代理等）
cp .env.example .env

# 启动主服务（会自动建表；不设 ADMIN_TOKEN 时生产管理区锁定）
docker compose up -d --build
```

验证健康检查：

```bash
curl http://127.0.0.1:8788/health
# {"ok":true,"version":"1.1.4",...}
```

### 可选：拉起 FlareSolverr 过 Cloudflare 护盾

大多数数据源（包括 `linux.do` RSS、OpenRouter、Epic、Steam、GamerPower、NodeSeek RSS 等）均可由容器内 `curl` / `fetch` 直连。如果你开启了需要复杂 Cloudflare 挑战的站点，可启用内置的 `cf` profile：

```bash
# 在 .env 中添加：FLARESOLVERR_URL=http://flaresolverr:8191
docker compose --profile cf up -d --build
```

> 服务已内置会话空闲 **90 秒** 自动销毁释放浏览器内存的机制，避免空闲时长期占用数百 MB RAM。

## 环境变量速查

`.env` 只管进程级变量；AI 模型、提示词、推送路由、屏蔽词等策略都在网页管理区热改，重启不丢。完整表格见 [README 的环境变量说明](https://github.com/ZiChuanLan/freebie-radar#环境变量说明env)，这里只列容易漏的几项：

| 变量 | 说明 |
|---|---|
| `ADMIN_TOKEN` | 管理区密码，公网部署必须设强密码 |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | 首次启动的 AI 默认值，之后在「AI 引擎」里改 |
| `AI_PROTOCOL` | 留空走 `/chat/completions`；`response` 走 `/responses`。基础地址只到 `/v1` |
| `PROMPT_URL` / `PROMPT_EXTRA_URL` / `PROMPT_SYNC_MINUTES` | 云端提示词，改审核口径不用发版，见「AI 语义审核」一页 |
| `ENABLE_SCHEDULER` | 关掉后只提供网页与 API，不跑采集/推送调度 |

## 反向代理（Nginx / Caddy）

建议使用 Caddy 或 Nginx 配置 HTTPS 反代并设置强 `ADMIN_TOKEN`：

```caddyfile
radar.example.com {
    reverse_proxy 127.0.0.1:8788
}
```

## 常用运维命令

```bash
cd freebie-radar

# 查看实时采集与推送日志
docker compose logs -f --tail 50

# 手动全量采集一次 / 或采集指定源
docker compose exec radar node --no-warnings src/server/cli.ts collect
docker compose exec radar node --no-warnings src/server/cli.ts collect linuxdo-welfare

# 批量 AI 补审或重审（pending | recent | rejected）
docker compose exec radar node --no-warnings src/server/cli.ts ai-review 100 pending

# 重新生成今日精选（--dry-run 只预览不写入/推送）
docker compose exec radar node --no-warnings src/server/cli.ts daily --dry-run

# 用镜像升级（推荐固定版本标签）
docker compose pull
docker compose up -d

# 从源码升级（数据保存在 ./data/radar.db 不会丢失）
git pull origin main
docker compose up -d --build
```

## 登录态站点接入（知乎 / 小红书 / 小黑盒）

这三类站点要求浏览器会话与前端动态签名，采用 **零 Cookie 上传** 方案：

1. 在你自己的桌面电脑或带图形界面的环境运行回环助手：
   ```bash
   SERVER_URL=https://your-radar-domain.com INGEST_TOKEN=your_token node scripts/pw-collect.mjs serve
   ```
2. 打开雷达网页「数据源运维」，点击对应源的 **「扫码登录」** 按钮：会跳往本地 `http://127.0.0.1:18789/login` 弹窗扫码；登录成功后自动采集一轮公开帖子推入 `/api/ingest`，**立即关闭浏览器释放全部内存并跳回雷达页面**。
3. 不想安装 Node / Playwright 的用户，也可在「数据源运维 → 登录态接入」中一键复制 **Tampermonkey 油猴脚本**，直接在日常浏览器里触发回传。

## 站点形态与外部工具入口

- **单人自建 vs 公开站（`SITE_MODE`）**：默认 `auto`（配齐 LINUX DO / GitHub OAuth 凭据即按公开站运行，否则按单人自建）。公开站账号隔离、邀请码与个人 Bot/RSS 详见 [公开站：登录与个人隔离](accounts.md)。
- **外部工具（`EPIC_CLAIMER_URL`）**：若单独部署了 Epic 喜加一领取器，在 `.env` 配置 `EPIC_CLAIMER_URL=https://你的领取器地址` 后，会在「数据源运维 → 外部工具」显示快捷入口卡片；未配置时不渲染。
