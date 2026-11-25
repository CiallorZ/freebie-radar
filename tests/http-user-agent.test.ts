import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cheapsharkCollector } from "../src/server/collectors/cheapshark.ts";
import { createHttp } from "../src/server/http.ts";

const DEAL = [
  { dealID: "1", title: "Test Game", storeID: "1", gameID: "1", salePrice: "0", normalPrice: "9.99", savings: "100", steamAppID: "123" },
];

test("CheapShark：传描述性 UA（API 明确要求，浏览器 UA 会被 Cloudflare 间歇 403）", async () => {
  let seenUa = "";
  const http = {
    json: async (url: string, opts?: { headers?: Record<string, string> }) => {
      seenUa = opts?.headers?.["user-agent"] ?? "";
      return { status: 200, url, data: DEAL, response: {} as never };
    },
    text: async () => {
      throw new Error("unused");
    },
    raw: async () => {
      throw new Error("unused");
    },
  };
  const out = await cheapsharkCollector.collect({
    sourceId: "cheapshark-free",
    config: { upperPrice: 1, pageSize: 40 },
    cursor: null,
    maxItems: 10,
    log: () => {},
    http: http as never,
  });
  assert.ok(seenUa.startsWith("FreebieRadar"), `got UA: ${seenUa}`);
  assert.equal(out.items.length, 1);
  assert.ok(out.items[0]!.title.includes("Test Game"));
});

test("http 层 curl 路径：自定义 user-agent 请求头会覆盖默认浏览器 UA", async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(req.headers["user-agent"] ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const http = createHttp({ gapMs: 0 });
    await http.text(`http://127.0.0.1:${port}/x`, {
      headers: { "user-agent": "FreebieRadar (https://github.com/CiallorZ/freebie-radar)" },
    });
    assert.equal(seen.length, 1);
    assert.ok(seen[0]!.startsWith("FreebieRadar"), `got UA: ${seen[0]}`);
    // 默认仍是浏览器 UA，不影响其它源过 Cloudflare
    await http.text(`http://127.0.0.1:${port}/x`);
    assert.ok(seen[1]!.includes("Chrome/131"), `got UA: ${seen[1]}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
