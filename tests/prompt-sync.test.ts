import assert from "node:assert/strict";
import { test } from "node:test";

import { PROMPT_MAX_CHARS, validatePromptText, validatePromptUrl } from "../src/server/enrich/prompt-source.ts";

test("云端提示词：只放行 https，本机回环例外", () => {
  assert.equal(validatePromptUrl("https://raw.githubusercontent.com/a/b/main/system.md"), null);
  assert.equal(validatePromptUrl("http://127.0.0.1:8080/system.md"), null);
  assert.equal(validatePromptUrl("http://example.com/system.md"), "只允许 https（本机调试可例外）");
  assert.equal(validatePromptUrl("ftp://example.com/x.md"), "只允许 https（本机调试可例外）");
  assert.equal(validatePromptUrl(""), "地址为空");
  assert.equal(validatePromptUrl("not a url"), "不是合法 URL");
});

test("云端提示词：空内容与非文本不得落库", () => {
  assert.equal(validatePromptText("  你是审核员  "), null);
  assert.equal(validatePromptText(""), "内容为空");
  assert.equal(validatePromptText("   \n  "), "内容为空");
  assert.equal(validatePromptText(undefined), "内容不是文本");
  assert.equal(validatePromptText(123), "内容不是文本");
});

test("云端提示词：超长内容拒绝，边界值恰好放行", () => {
  const ok = "a".repeat(PROMPT_MAX_CHARS);
  assert.equal(validatePromptText(ok), null);
  assert.equal(validatePromptText("a".repeat(PROMPT_MAX_CHARS + 1)), `内容超过 ${PROMPT_MAX_CHARS} 字`);
});
