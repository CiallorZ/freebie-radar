import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHttp } from "../src/server/http.ts";

async function withServer(
  handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void,
  fn: (port: number, hits: () => number) => Promise<void>,
) {
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await fn(port, () => hits);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("E6：429 第一次、200 第二次（Retry-After: 0 立即重试）", async () => {
  let n = 0;
  await withServer((_req, res) => {
    n++;
    if (n === 1) {
      res.writeHead(429, { "retry-after": "0", "content-type": "text/plain" });
      res.end("slow down");
    } else {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    }
  }, async (port, hits) => {
    const http = createHttp({ gapMs: 0 });
    const r = await http.text(`http://127.0.0.1:${port}/x`);
    assert.equal(r.status, 200);
    assert.equal(r.body, "ok");
    assert.equal(hits(), 2);
  });
});

test("E6：两次都 429 时只重试一次，返回最后一次的 429", async () => {
  await withServer((_req, res) => {
    res.writeHead(429, { "retry-after": "0", "content-type": "text/plain" });
    res.end("slow down");
  }, async (port, hits) => {
    const http = createHttp({ gapMs: 0 });
    const r = await http.text(`http://127.0.0.1:${port}/x`);
    assert.equal(r.status, 429);
    assert.equal(hits(), 2);
  });
});

test("E6：500 不重试，只请求一次", async () => {
  await withServer((_req, res) => {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("boom");
  }, async (port, hits) => {
    const http = createHttp({ gapMs: 0 });
    const r = await http.text(`http://127.0.0.1:${port}/x`);
    assert.equal(r.status, 500);
    assert.equal(hits(), 1);
  });
});

test("E6：503 带过去的 HTTP 日期 Retry-After 时立即重试", async () => {
  let n = 0;
  await withServer((_req, res) => {
    n++;
    if (n === 1) {
      res.writeHead(503, {
        "retry-after": new Date(Date.now() - 60_000).toUTCString(),
        "content-type": "text/plain",
      });
      res.end("busy");
    } else {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    }
  }, async (port, hits) => {
    const http = createHttp({ gapMs: 0 });
    const r = await http.text(`http://127.0.0.1:${port}/x`);
    assert.equal(r.status, 200);
    assert.equal(hits(), 2);
  });
});

test("E6：GET 连不上时重试一次后抛错", async () => {
  // 拿一个已关闭的本地端口：连接被拒是即时失败，不会等超时
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const http = createHttp({ gapMs: 0, timeoutMs: 2000 });
  await assert.rejects(() => http.text(`http://127.0.0.1:${port}/x`));
});
