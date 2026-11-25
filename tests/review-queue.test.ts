import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldQueueForReview } from "../src/server/enrich/classify.ts";

const base = {
  claim: false, giveaway: false, hasCodes: false, entitlement: false,
  project: false, paid: false, promo: false, titleDeal: false, titlePromo: false,
  revoked: false, question: true, warning: false, selfPromo: false, announcement: false, editorial: false,
};

test("待复核：AI 说是福利但证据里没有可领取对象", () => {
  assert.equal(shouldQueueForReview({ keep: true, kind: "freebie", status: "active", hasManualOverride: false, evidence: base }), true);
});

test("待复核：有任一领取证据就放行", () => {
  for (const key of ["claim", "giveaway", "hasCodes", "entitlement", "project"] as const) {
    const evidence = { ...base, [key]: true };
    assert.equal(shouldQueueForReview({ keep: true, kind: "freebie", status: "active", hasManualOverride: false, evidence }), false, key);
  }
});

test("待复核：非福利、已拒绝、已有人工分类、非 active 都不进队列", () => {
  assert.equal(shouldQueueForReview({ keep: true, kind: "deal", status: "active", hasManualOverride: false, evidence: base }), false);
  assert.equal(shouldQueueForReview({ keep: false, kind: "freebie", status: "active", hasManualOverride: false, evidence: base }), false);
  assert.equal(shouldQueueForReview({ keep: true, kind: "freebie", status: "active", hasManualOverride: true, evidence: base }), false);
  assert.equal(shouldQueueForReview({ keep: true, kind: "freebie", status: "ignored", hasManualOverride: false, evidence: base }), false);
});
