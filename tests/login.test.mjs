// ログイン: 状態の判定（終了コード・出力のパターン）と、ターミナルで流すスクリプト。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loginStatus, loginScript, shQuote } = require("../src/core/login.js");
const { makeContext } = require("../src/core/platform.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aisetup-login-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const ctx = makeContext({ os: "darwin", home: tmp });
const envInfo = { loginPath: ["/usr/bin", "/bin"], searchPath: ["/usr/bin", "/bin"] };

// 終了コードと出力を決められる偽のコマンド
function fakeCommand(name, { code = 0, out = "" }) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, `#!/bin/sh\nprintf '%s' ${shQuote(out)}\nexit ${code}\n`, { mode: 0o755 });
  return file;
}
const item = (status, file) => ({
  id: "x",
  name: "X",
  platforms: { darwin: { detect: { command: "x" } } },
  login: { command: ["x", "login"], status: { command: ["x", "status"], ...status } },
});

test("loginStatus: 終了コードで判定する", async () => {
  const ok = fakeCommand("ok", { code: 0 });
  const ng = fakeCommand("ng", { code: 1, out: "Not logged in" });
  assert.deepEqual(await loginStatus(item({ loggedInExitCode: 0 }), ctx, envInfo, { path: ok }), { loggedIn: true });
  assert.deepEqual(await loginStatus(item({ loggedInExitCode: 0 }), ctx, envInfo, { path: ng }), { loggedIn: false });
});

test("loginStatus: 出力のパターンで判定する（終了コードが当てにならないもの）", async () => {
  const yes = fakeCommand("yes", { code: 0, out: '{"email":"a@b"}' });
  const no = fakeCommand("no", { code: 0, out: "" });
  assert.deepEqual(await loginStatus(item({ loggedInPattern: '"email"' }), ctx, envInfo, { path: yes }), { loggedIn: true });
  assert.deepEqual(await loginStatus(item({ loggedInPattern: '"email"' }), ctx, envInfo, { path: no }), { loggedIn: false });
});

test("loginStatus: コマンドが見つからなければ「分からない」", async () => {
  const r = await loginStatus(item({ loggedInExitCode: 0 }), ctx, envInfo, { path: null });
  assert.equal(r.loggedIn, null);
});

test("loginScript: 空白や引用符を含んでも1語として渡る", () => {
  const file = fakeCommand("echo args", { code: 0 });
  fs.writeFileSync(file, '#!/bin/sh\nfor a in "$@"; do echo "[$a]"; done\n', { mode: 0o755 });
  const script = loginScript({ name: "X" }, file, ["a b", "it's"], ctx, envInfo).replace("clear\n", "");
  const out = execFileSync("/bin/zsh", ["-c", script], { encoding: "utf8" });
  assert.match(out, /\[a b\]\n\[it's\]/);
  assert.match(script, new RegExp(`export HOME=${shQuote(tmp).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`));
});
