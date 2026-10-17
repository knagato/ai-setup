// 手順の実行: ドライランは何もしないこと、子プロセスの出力を行ごとに流すこと、失敗と中断。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { runSteps, fill } = require("../src/core/runner.js");
const { makeContext } = require("../src/core/platform.js");

const ctx = makeContext({ os: "darwin", home: fs.mkdtempSync(path.join(os.tmpdir(), "aisetup-run-")) });
const envInfo = { loginPath: ["/usr/bin", "/bin"], searchPath: ["/usr/bin", "/bin"] };

test("fill: {tmp} と {appPath} を埋める", () => {
  assert.deepEqual(fill({ a: ["{tmp}/x", "{appPath}/y", "{other}"] }, { tmp: "/t", appPath: "/A" }), { a: ["/t/x", "/A/y", "{other}"] });
});

test("ドライランは実行も書き込みもしない", async () => {
  const lines = [];
  const link = path.join(ctx.home, "link");
  await runSteps(
    [
      { kind: "spawn", cmd: "/bin/sh", args: ["-c", `touch ${path.join(ctx.home, "touched")}`] },
      { kind: "symlink", target: "/bin/sh", link },
    ],
    { ctx, envInfo, dryRun: true, onLog: (l) => lines.push(l) },
  );
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.startsWith("▶ ")));
  assert.ok(!fs.existsSync(path.join(ctx.home, "touched")));
  assert.ok(!fs.existsSync(link));
});

test("出力を行ごとに流し、色の制御文字を落とす", async () => {
  const lines = [];
  await runSteps([{ kind: "spawn", cmd: "/bin/sh", args: ["-c", "printf '\\033[32mok\\033[0m\\none\\ntwo'; echo err >&2"] }], {
    ctx,
    envInfo,
    onLog: (l) => lines.push(l),
  });
  assert.deepEqual(lines.slice(1).sort(), ["err", "ok", "one", "two"].sort());
});

test("失敗したら最後の出力を付けて失敗する", async () => {
  await assert.rejects(
    runSteps([{ kind: "spawn", cmd: "/bin/sh", args: ["-c", "echo boom; exit 3"] }], { ctx, envInfo }),
    (e) => /終了コード 3/.test(e.message) && e.tail.includes("boom"),
  );
});

test("中断すると子プロセスを止める", async () => {
  const ac = new AbortController();
  const started = Date.now();
  setTimeout(() => ac.abort(), 200);
  await assert.rejects(
    runSteps([{ kind: "spawn", cmd: "/bin/sh", args: ["-c", "sleep 30"] }], { ctx, envInfo, signal: ac.signal }),
    /中断/,
  );
  assert.ok(Date.now() - started < 5000);
});

test("symlink: 自分のリンクは張り替え、普通のファイルは触らない", async () => {
  const link = path.join(ctx.home, "bin", "tool");
  await runSteps([{ kind: "symlink", target: "/bin/sh", link }], { ctx, envInfo });
  await runSteps([{ kind: "symlink", target: "/bin/ls", link }], { ctx, envInfo });
  assert.equal(fs.readlinkSync(link), "/bin/ls");
  const plain = path.join(ctx.home, "bin", "plain");
  fs.writeFileSync(plain, "mine");
  await runSteps([{ kind: "symlink", target: "/bin/sh", link: plain }], { ctx, envInfo });
  assert.equal(fs.readFileSync(plain, "utf8"), "mine");
});

test("childEnv: 仮のホームでは、本物のホームを指す変数を渡さない", () => {
  const { childEnv } = require("../src/core/env.js");
  const real = os.homedir();
  process.env.AISETUP_TEST_DIR = path.join(real, ".something");
  try {
    const env = childEnv(ctx, envInfo, { KEEP: path.join(real, "x") });
    assert.equal(env.AISETUP_TEST_DIR, undefined);
    assert.equal(env.KEEP, path.join(real, "x")); // カタログで明示したものは残す
    assert.equal(env.HOME, ctx.home);
  } finally {
    delete process.env.AISETUP_TEST_DIR;
  }
});

// --- Xcode のコマンドライン・ツール（OS のダイアログ） ---
const { xcodeClt } = require("../src/core/runner.js");
const realCtx = makeContext({ os: "darwin", env: {} }); // 仮のホームでは入れないので、ホームを装わない

// probe の答えを、呼ばれた回数ごとに並べておく（足りなくなったら最後の値を返し続ける）
function fakeProbe({ installed, dialogOpen }) {
  const seq = (list) => {
    let i = 0;
    return async () => list[Math.min(i++, list.length - 1)];
  };
  return { installed: seq(installed), dialogOpen: seq(dialogOpen), request: async () => {} };
}

test("xcodeClt: 入り終わったら成功し、出したときに知らせる", async () => {
  const lines = [];
  const attention = [];
  await xcodeClt(
    realCtx,
    { onLog: (l) => lines.push(l), onAttention: (m) => attention.push(m) },
    { pollMs: 1, probe: fakeProbe({ installed: [false, false, false, true], dialogOpen: [true] }) },
  );
  assert.equal(attention.length, 1);
  assert.match(attention[0], /「インストール」を押してください/);
  assert.equal(lines.at(-1), "Xcode のコマンドライン・ツールが入りました");
});

test("xcodeClt: ダイアログが閉じられたら、時間切れを待たずに失敗する", async () => {
  const started = Date.now();
  await assert.rejects(
    xcodeClt(realCtx, { onLog: () => {} }, { pollMs: 1, timeoutMs: 60000, probe: fakeProbe({ installed: [false], dialogOpen: [true, true, false] }) }),
    /ダイアログが閉じられた/,
  );
  assert.ok(Date.now() - started < 5000);
});

test("xcodeClt: ダイアログを一度も見ていなければ、閉じたとは判断しない", async () => {
  await assert.rejects(
    xcodeClt(realCtx, { onLog: () => {} }, { pollMs: 1, timeoutMs: 50, probe: fakeProbe({ installed: [false], dialogOpen: [false] }) }),
    (e) => /時間内に入り終わりませんでした/.test(e.message) && !/画面に残っている/.test(e.message),
  );
});

test("xcodeClt: 押されないまま時間切れになったら、残っているダイアログを押すよう案内し、途中でも知らせる", async () => {
  const attention = [];
  await assert.rejects(
    xcodeClt(
      realCtx,
      { onLog: () => {}, onAttention: (m) => attention.push(m) },
      { pollMs: 5, timeoutMs: 100, remindMs: 30, probe: fakeProbe({ installed: [false], dialogOpen: [true] }) },
    ),
    /画面に残っているダイアログで「インストール」を押してから/,
  );
  assert.ok(attention.length >= 2, `知らせた回数: ${attention.length}`);
});

test("xcodeClt: 入っていれば何もしない", async () => {
  const attention = [];
  await xcodeClt(realCtx, { onLog: () => {}, onAttention: (m) => attention.push(m) }, { probe: fakeProbe({ installed: [true], dialogOpen: [false] }) });
  assert.equal(attention.length, 0);
});

test("askpass: sudo -A に渡すスクリプトを用意し、終わったら消す。仮のホームでは使わない", async () => {
  const realHome = makeContext({ os: "darwin", env: {} });
  let seen = null;
  const attention = [];
  await runSteps(
    [{ kind: "spawn", cmd: "/bin/sh", args: ["-c", 'cat "$SUDO_ASKPASS"; echo; echo "$SUDO_ASKPASS"'], askpass: "パスワードを\"入れて\"ください" }],
    { ctx: realHome, envInfo, onLog: (l) => (seen = seen ? `${seen}\n${l}` : l), onAttention: (m) => attention.push(m) },
  );
  assert.match(seen, /osascript -e/);
  assert.match(seen, /with hidden answer/);
  assert.match(seen, /パスワードを\\"入れて\\"ください/);
  const file = seen.trim().split("\n").at(-1);
  assert.ok(!fs.existsSync(file), "一時フォルダごと消える");
  assert.equal(attention.length, 1);

  await assert.rejects(
    runSteps([{ kind: "spawn", cmd: "/bin/true", args: [], askpass: "x" }], { ctx, envInfo }),
    /仮のホームでは/,
  );
});
