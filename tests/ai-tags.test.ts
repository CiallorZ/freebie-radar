import assert from "node:assert/strict";
import { test } from "node:test";

import { AI_TAG_MAX, normalizeAiTags } from "../src/server/enrich/ai-settings.ts";

test("AI 标签：去重、去 # 号、压空白、上限 4 个", () => {
  assert.deepEqual(normalizeAiTags(["#Steam", "steam", "Steam", " 年付 VPS "]), ["Steam", "steam", "年付 VPS"]);
  assert.deepEqual(normalizeAiTags(["a", "b", "c", "d", "e"]).length, AI_TAG_MAX);
});

test("AI 标签：非数组与非法元素直接丢弃，不影响主判定", () => {
  assert.deepEqual(normalizeAiTags(undefined), []);
  assert.deepEqual(normalizeAiTags("Steam"), []);
  assert.deepEqual(normalizeAiTags([1, null, {}, "Steam"]), ["Steam"]);
});

test("AI 标签：超长与空串被过滤", () => {
  assert.deepEqual(normalizeAiTags(["a".repeat(17), "", "   ", "OK"]), ["OK"]);
  assert.deepEqual(normalizeAiTags(["a".repeat(16)]), ["a".repeat(16)]);
});
