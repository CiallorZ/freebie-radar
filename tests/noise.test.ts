import assert from "node:assert/strict";
import { test } from "node:test";

import { isNoiseTitle } from "../src/server/enrich/noise.ts";

test("引流推广标题判噪音：留 ID / 进群 / 私信 / 中转站", () => {
  assert.equal(isNoiseTitle("留 ID 领 3 个月会员"), true);
  assert.equal(isNoiseTitle("评论区留 ID，拉你进群"), true);
  assert.equal(isNoiseTitle("进群领 100G 网盘资源"), true);
  assert.equal(isNoiseTitle("私信我领 GPT-5 体验码"), true);
  assert.equal(isNoiseTitle("某中转站推广：注册送额度"), true);
});

test("能直接领取的福利不判噪音，即使提到群", () => {
  assert.equal(isNoiseTitle("注册即送 $5 额度，无需加群"), false);
  assert.equal(isNoiseTitle("Steam 喜加一：某游戏限时免费入库"), false);
  assert.equal(isNoiseTitle("免费领 3 个月 Gemini Pro（附领取链接）"), false);
});

test("教程类不被「如何」前缀误判", () => {
  assert.equal(isNoiseTitle("如何免费领取开发者学生包（附教程与步骤）"), false);
});
