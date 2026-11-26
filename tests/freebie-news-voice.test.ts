import assert from "node:assert/strict";
import { test } from "node:test";

import { enforceFreebieEvidence } from "../src/server/enrich/index.ts";

const run = (title: string, category: string, sourceId = "tg-cn-deals") =>
  enforceFreebieEvidence("freebie", "free", title, category, {
    summary: "", isFree: true, codes: [], sourceId,
  }).kind;

test("新闻腔/提问且无领取证据：资讯类分类下不判福利", () => {
  assert.equal(run("红果筹备电视端：以后在家刷短剧，还能免费吗？", "tech"), "info");
  assert.equal(run("华为鸿蒙终端设备数破亿，消息称今日下午还有重磅福利活动", "tech"), "info");
  assert.equal(run("某厂商据悉将推免费套餐", "tech"), "info");
});

test("社区直给帖不受影响：送对象、口令、福利前缀都保留", () => {
  assert.equal(run("送一个美国静态IP，还有20天剩余，需要前置代理。", "other"), "freebie");
  assert.equal(run("muse账号2个（用不完了）", "other"), "freebie");
  assert.equal(run("今日移动话费口令", "tech"), "freebie");
  assert.equal(run("[福利]开放一天免费nsfw生图", "other"), "freebie");
});

test("明确的领取动作仍然判福利", () => {
  assert.equal(run("免费领 3 个月 Gemini Pro（附领取链接）", "ai"), "freebie");
  assert.equal(run("Epic 喜加一：本周免费游戏", "game"), "freebie");
});
