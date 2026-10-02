// ダウンロード: ハッシュの照合、BOM の付与、許可リスト。手元の HTTP サーバだけを相手にする。
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { download, isAllowedUrl } = require("../src/core/download.js");

const body = Buffer.from("echo hello\n");
const server = http.createServer((req, res) => {
  if (req.url === "/redirect") {
    res.writeHead(302, { location: "/file" });
    return res.end();
  }
  res.writeHead(200, { "content-length": body.length });
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const allowLocal = (u) => u.startsWith(base);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aisetup-test-"));
test.after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("許可リスト", () => {
  assert.ok(isAllowedUrl("https://claude.ai/install.sh"));
  assert.ok(isAllowedUrl("https://release-assets.githubusercontent.com/x"));
  assert.ok(!isAllowedUrl("http://claude.ai/install.sh"));
  assert.ok(!isAllowedUrl("https://claude.ai.evil.example/x"));
  assert.ok(!isAllowedUrl("https://evilgithubusercontent.com/x"));
});

test("許可していない取得元は取りに行かない", async () => {
  await assert.rejects(download(`${base}/file`, path.join(tmp, "x")), /許可していない/);
});

test("ハッシュが合えば保存し、進み具合を知らせる", async () => {
  const digest = crypto.createHash("sha512").update(body).digest("base64");
  const dest = path.join(tmp, "ok");
  let last;
  await download(`${base}/redirect`, dest, {
    allow: allowLocal,
    hash: { algo: "sha512", digest, encoding: "base64" },
    onProgress: (p) => (last = p),
  });
  assert.deepEqual(fs.readFileSync(dest), body);
  assert.deepEqual(last, { received: body.length, total: body.length });
});

test("ハッシュが違えば消して失敗する", async () => {
  const dest = path.join(tmp, "bad");
  await assert.rejects(
    download(`${base}/file`, dest, { allow: allowLocal, hash: { algo: "sha256", digest: "00", encoding: "hex" } }),
    /ハッシュが一致しません/,
  );
  assert.ok(!fs.existsSync(dest));
});

test("PowerShell 用に BOM を付ける（ハッシュは元の中身で計算）", async () => {
  const dest = path.join(tmp, "bom.ps1");
  const digest = crypto.createHash("sha256").update(body).digest("hex");
  await download(`${base}/file`, dest, { allow: allowLocal, addBom: true, hash: { algo: "sha256", digest } });
  assert.deepEqual(fs.readFileSync(dest), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]));
});
