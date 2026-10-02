// AI Setup 自身の更新: 版の比較、マニフェストの読み方、入れ替えられない場所、入れ替えのシェル。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { compareVersions, checkForUpdate, appBundlePath, whyCannotReplace, swapCommand } = require("../src/core/selfupdate.js");
const { makeContext } = require("../src/core/platform.js");

const mac = (arch) => makeContext({ os: "darwin", arch, home: "/Users/u" });
const win = (arch) => makeContext({ os: "win32", arch, home: "C:\\Users\\u" });

test("compareVersions", () => {
  assert.equal(compareVersions("0.2.0", "0.1.0"), 1);
  assert.equal(compareVersions("0.1.10", "0.1.9"), 1);
  assert.equal(compareVersions("v1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.1"), 1);
  assert.equal(compareVersions("0.9.9", "1.0.0"), -1);
});

const MAC_YML = `version: 0.2.0
files:
  - url: AI-Setup-0.2.0-arm64-mac.zip
    sha512: ARM==
    size: 100
  - url: AI-Setup-0.2.0-x64-mac.zip
    sha512: X64==
    size: 200
  - url: AI-Setup-0.2.0-arm64.dmg
    sha512: DMG==
    size: 300
path: AI-Setup-0.2.0-arm64-mac.zip
releaseDate: '2026-10-03T00:00:00.000Z'
`;

test("checkForUpdate: mac は自分のアーキテクチャの zip を選ぶ", async () => {
  const urls = [];
  const fetchText = async (url) => (urls.push(url), MAC_YML);
  const r = await checkForUpdate("0.1.0", mac("x64"), { fetchText });
  assert.deepEqual(urls, ["https://github.com/knagato/ai-setup/releases/latest/download/latest-mac.yml"]);
  assert.deepEqual(r, {
    available: true,
    current: "0.1.0",
    latest: "0.2.0",
    url: "https://github.com/knagato/ai-setup/releases/download/v0.2.0/AI-Setup-0.2.0-x64-mac.zip",
    hash: { algo: "sha512", digest: "X64==", encoding: "base64" },
    size: 200,
  });
});

test("checkForUpdate: 同じ版・古い版なら何もしない", async () => {
  const fetchText = async () => MAC_YML;
  assert.deepEqual(await checkForUpdate("0.2.0", mac("arm64"), { fetchText }), { available: false, current: "0.2.0", latest: "0.2.0" });
  assert.equal((await checkForUpdate("0.3.0", mac("arm64"), { fetchText })).available, false);
});

test("checkForUpdate: Windows は latest.yml の exe を選ぶ", async () => {
  const yml = "version: 0.2.0\nfiles:\n  - url: AI-Setup-0.2.0-win-setup.exe\n    sha512: EXE==\n    size: 5\n";
  const urls = [];
  const r = await checkForUpdate("0.1.0", win("arm64"), { fetchText: async (u) => (urls.push(u), yml) });
  assert.match(urls[0], /\/latest\.yml$/);
  assert.equal(r.url, "https://github.com/knagato/ai-setup/releases/download/v0.2.0/AI-Setup-0.2.0-win-setup.exe");
  assert.equal(r.hash.digest, "EXE==");
});

test("checkForUpdate: 自分向けのファイルが無ければ失敗する", async () => {
  const yml = "version: 0.2.0\nfiles:\n  - url: AI-Setup-0.2.0-x64-mac.zip\n    sha512: X64==\n";
  await assert.rejects(checkForUpdate("0.1.0", mac("arm64"), { fetchText: async () => yml }), /arm64/);
  await assert.rejects(checkForUpdate("0.1.0", mac("arm64"), { fetchText: async () => "files: []\n" }), /version/);
});

test("appBundlePath", () => {
  assert.equal(appBundlePath("/Applications/AI Setup.app/Contents/MacOS/AI Setup"), "/Applications/AI Setup.app");
  assert.equal(appBundlePath("/usr/local/bin/electron"), null);
});

test("whyCannotReplace: ディスクイメージ・隔離された場所・書けない場所", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aisetup-su-"));
  assert.equal(whyCannotReplace(path.join(tmp, "AI Setup.app")), null);
  assert.match(whyCannotReplace("/Volumes/AI Setup/AI Setup.app"), /アプリケーション/);
  assert.match(whyCannotReplace("/private/var/folders/x/AppTranslocation/ABC/d/AI Setup.app"), /アプリケーション/);
  assert.match(whyCannotReplace("/System/AI Setup.app"), /入れ替えられません/);
  assert.match(whyCannotReplace(null), /分かりません/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// 入れ替えのシェルを、終わったプロセスと偽の open で動かす
async function runSwap({ breakMove = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aisetup-swap-"));
  const appPath = path.join(tmp, "Applications", "AI Setup.app");
  const work = path.join(tmp, "work");
  const newApp = path.join(work, "new", "AI Setup.app");
  fs.mkdirSync(appPath, { recursive: true });
  fs.writeFileSync(path.join(appPath, "version"), "old");
  fs.mkdirSync(newApp, { recursive: true });
  fs.writeFileSync(path.join(newApp, "version"), "new");
  if (breakMove) fs.rmSync(newApp, { recursive: true }); // 新しい版が置けない状況

  const bin = path.join(tmp, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "open"), `#!/bin/sh\necho "$1" > "${path.join(tmp, "opened")}"\n`, { mode: 0o755 });

  const done = spawn("/usr/bin/true");
  await new Promise((r) => done.on("close", r));
  const { cmd, args } = swapCommand({ pid: done.pid, appPath, newApp, work });
  const out = await new Promise((resolve) => {
    let text = "";
    const child = spawn(cmd, args, { env: { PATH: `${bin}:/usr/bin:/bin` } });
    child.stdout.on("data", (c) => (text += c));
    child.on("close", () => resolve(text));
  });
  const result = {
    out,
    version: fs.readFileSync(path.join(appPath, "version"), "utf8"),
    opened: fs.readFileSync(path.join(tmp, "opened"), "utf8").trim(),
    workLeft: fs.existsSync(work),
    appPath,
  };
  fs.rmSync(tmp, { recursive: true, force: true });
  return result;
}

test("入れ替え: 新しい版に置き換えて開き直す", async () => {
  const r = await runSwap();
  assert.equal(r.version, "new");
  assert.equal(r.opened, r.appPath);
  assert.equal(r.workLeft, false);
  assert.match(r.out, /入れ替えました/);
});

test("入れ替え: 置けなかったら元の版に戻して開く", async () => {
  const r = await runSwap({ breakMove: true });
  assert.equal(r.version, "old");
  assert.equal(r.opened, r.appPath);
  assert.match(r.out, /元に戻します/);
});
