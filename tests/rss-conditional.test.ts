import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { rssCollector } from "../src/server/collectors/rss.ts";
import { createHttp } from "../src/server/http.ts";

const FEED_XML = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Test</title>
  <item><title>免费测试 A</title><link>https://example.com/a</link></item>
</channel></rss>`;

const FEED_XML_B = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>TestB</title>
  <item><title>免费测试 B</title><link>https://example.com/b</link></item>
</channel></rss>`;

type SeenCall = { url: string; headers?: Record<string, string> };

function fakeHttp(status: number, headers: Record<string, string> = {}, body = FEED_XML) {
  const seen: SeenCall[] = [];
  return {
    seen,
    http: {
      text: async (url: string, opts?: { headers?: Record<string, string> }) => {
        seen.push({ url, headers: opts?.headers });
        return { status, url, body, headers: new Headers(headers), bytes: Buffer.alloc(0), contentType: "application/xml" };
      },
      json: async () => {
        throw new Error("unused");
      },
      raw: async () => {
        throw new Error("unused");
      },
    },
  };
}

const BASE_CTX = {
  sourceId: "rss-test-cond",
  maxItems: 10,
  log: () => {},
} as const;

test("E5：200 返回 ETag/Last-Modified 时存入 cursor，下次带条件请求头", async () => {
  const f = fakeHttp(200, { etag: '"v1"', "last-modified": "Sat, 21 Nov 2026 00:00:00 GMT" });
  const out = await rssCollector.collect({
    ...BASE_CTX,
    cursor: null,
    config: { feeds: [{ id: "t", url: "https://example.com/rss.xml" }] },
    http: f.http as never,
  });
  assert.equal(out.items.length, 1);
  assert.ok(out.cursor);
  const saved = JSON.parse(out.cursor!) as Record<string, { etag?: string; lastModified?: string }>;
  assert.equal(saved.t?.etag, '"v1"');
  assert.equal(saved.t?.lastModified, "Sat, 21 Nov 2026 00:00:00 GMT");
});

test("E5：304 直接跳过解析，本轮算成功且 cursor 不变", async () => {
  const cursor = JSON.stringify({ t: { etag: '"v1"', lastModified: "Sat, 21 Nov 2026 00:00:00 GMT" } });
  const f = fakeHttp(304, {}, "");
  const out = await rssCollector.collect({
    ...BASE_CTX,
    cursor,
    config: { feeds: [{ id: "t", url: "https://example.com/rss.xml" }] },
    http: f.http as never,
  });
  assert.equal(out.items.length, 0);
  assert.equal(out.cursor, cursor);
  assert.equal(f.seen[0]?.headers?.["if-none-match"], '"v1"');
  assert.equal(f.seen[0]?.headers?.["if-modified-since"], "Sat, 21 Nov 2026 00:00:00 GMT");
});

test("E5：老格式 cursor 直接忽略，不带条件请求头", async () => {
  const f = fakeHttp(200, {}, FEED_XML);
  const out = await rssCollector.collect({
    ...BASE_CTX,
    cursor: "page-123",
    config: { feeds: [{ id: "t", url: "https://example.com/rss.xml" }] },
    http: f.http as never,
  });
  assert.equal(out.items.length, 1);
  assert.equal(out.cursor, null);
  assert.deepEqual(f.seen[0]?.headers ?? {}, {});
});

test("E5：多 feed 混合——304 的保留旧校验值，200 的更新", async () => {
  const cursor = JSON.stringify({ a: { etag: '"old-a"' } });
  const seen: SeenCall[] = [];
  const http = {
    text: async (url: string, opts?: { headers?: Record<string, string> }) => {
      seen.push({ url, headers: opts?.headers });
      if (url.includes("/a.xml")) {
        return { status: 304, url, body: "", headers: new Headers(), bytes: Buffer.alloc(0), contentType: "application/xml" };
      }
      return {
        status: 200,
        url,
        body: FEED_XML_B,
        headers: new Headers({ etag: '"new-b"' }),
        bytes: Buffer.alloc(0),
        contentType: "application/xml",
      };
    },
    json: async () => {
      throw new Error("unused");
    },
    raw: async () => {
      throw new Error("unused");
    },
  };
  const out = await rssCollector.collect({
    ...BASE_CTX,
    cursor,
    config: {
      feeds: [
        { id: "a", url: "https://example.com/a.xml" },
        { id: "b", url: "https://example.com/b.xml" },
      ],
    },
    http: http as never,
  });
  assert.equal(out.items.length, 1);
  assert.ok(out.items[0]!.title.includes("测试 B"));
  const saved = JSON.parse(out.cursor!) as Record<string, { etag?: string }>;
  assert.equal(saved.a?.etag, '"old-a"');
  assert.equal(saved.b?.etag, '"new-b"');
  assert.equal(seen[0]?.headers?.["if-none-match"], '"old-a"');
});

test("E5：http 层带回 ETag，条件请求拿到 304", async () => {
  const server = createServer((req, res) => {
    if (req.headers["if-none-match"] === '"v1"') {
      res.writeHead(304, { etag: '"v1"' });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/rss+xml", etag: '"v1"', "last-modified": "Sat, 21 Nov 2026 00:00:00 GMT" });
    res.end(FEED_XML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const http = createHttp({ gapMs: 0 });
    const first = await http.text(`http://127.0.0.1:${port}/feed.xml`);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("etag"), '"v1"');
    assert.equal(first.headers.get("last-modified"), "Sat, 21 Nov 2026 00:00:00 GMT");
    const second = await http.text(`http://127.0.0.1:${port}/feed.xml`, { headers: { "if-none-match": '"v1"' } });
    assert.equal(second.status, 304);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
