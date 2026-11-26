import assert from "node:assert/strict";
import { test } from "node:test";

import { enforceFreebieEvidence } from "../src/server/enrich/index.ts";

const run = (title: string, category = "software") =>
  enforceFreebieEvidence("freebie", "free", title, category, {
    summary: "", isFree: true, codes: [], sourceId: "rss-ghxi",
  }).kind;

test("重新打包的绿色版/修改版不是福利，是软件下载", () => {
  assert.equal(run("Server Box(Linux服务器工具箱) v1.0.1962 绿色版"), "info");
  assert.equal(run("StartAllBack(开始菜单增强工具) v3.9.29.5431 修改版"), "info");
  assert.equal(run("迅雷17 v25.1.50.1751 绿色精简版"), "info");
  assert.equal(run("IObit Driver Booster Pro v14.1.0.572 便携修改版"), "info");
});

test("带明确领取动作的正版授权仍然是福利", () => {
  assert.equal(run("某软件限时免费领取正版序列号"), "freebie");
  assert.equal(run("免费领 3 个月 Gemini Pro（附领取链接）", "ai"), "freebie");
});
