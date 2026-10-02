// OS × アーキテクチャごとの手順を固定値と照合する。ネットには繋がない（固定版を使う）。
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadCatalog } = require("../src/core/catalog.js");
const { makeContext, expand } = require("../src/core/platform.js");
const { resolveRelease, parseUpdaterYaml } = require("../src/core/resolvers.js");
const { planItem } = require("../src/core/plan.js");

const items = new Map(loadCatalog().map((i) => [i.id, i]));
const ctxFor = (os, arch) => makeContext({ os, arch, home: os === "win32" ? "C:\\Users\\u" : "/Users/u" });

async function stepsFor(id, os, arch, opts) {
  const ctx = ctxFor(os, arch);
  const item = items.get(id);
  const release = await resolveRelease(item.platforms[os].install, ctx, { offline: true });
  return planItem(item, ctx, release, opts).steps;
}

test("expand: ~ と %VAR%", () => {
  const mac = ctxFor("darwin", "arm64");
  assert.equal(expand(mac, "~/.local/bin"), "/Users/u/.local/bin");
  const win = ctxFor("win32", "x64");
  assert.equal(expand(win, "~\\.local\\bin"), "C:\\Users\\u\\.local\\bin");
  assert.equal(expand(win, "%LOCALAPPDATA%\\Programs"), "C:\\Users\\u\\AppData\\Local\\Programs");
});

test("Claude Code（mac）: 公式スクリプト → PATH", async () => {
  assert.deepEqual(await stepsFor("claude-code", "darwin", "arm64"), [
    { kind: "download", url: "https://claude.ai/install.sh", dest: "{tmp}/install.sh" },
    { kind: "spawn", cmd: "/bin/bash", args: ["{tmp}/install.sh"], env: {} },
    { kind: "ensurePath", dir: "/Users/u/.local/bin" },
  ]);
});

test("Codex（Windows）: BOM 付きで保存して PowerShell で実行", async () => {
  const steps = await stepsFor("codex", "win32", "arm64");
  assert.deepEqual(steps[0], { kind: "download", url: "https://chatgpt.com/codex/install.ps1", dest: "{tmp}\\install.ps1", addBom: true });
  assert.equal(steps[1].cmd, "powershell.exe");
  assert.deepEqual(steps[1].env, { CODEX_NON_INTERACTIVE: "1" });
  assert.deepEqual(steps[2], { kind: "ensurePath", dir: "C:\\Users\\u\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin" });
});

for (const arch of ["arm64", "x64"]) {
  test(`Paseo（mac ${arch}）: zip を確かめて配置し、CLI のリンクを張る`, async () => {
    const steps = await stepsFor("paseo", "darwin", arch);
    assert.deepEqual(
      steps.map((s) => s.kind),
      ["download", "unzip", "verifyMacApp", "installMacApp", "symlink", "ensurePath"],
    );
    assert.equal(steps[0].url, `https://github.com/getpaseo/paseo/releases/download/v0.10.3/Paseo-0.10.3-${arch}.zip`);
    assert.equal(steps[0].hash.algo, "sha512");
    assert.equal(steps[2].teamId, "99ZMJMKU9Y");
    assert.deepEqual(steps[4], { kind: "symlink", target: "{appPath}/Contents/Resources/bin/paseo", link: "/Users/u/.local/bin/paseo" });
  });

  test(`Paseo（Windows ${arch}）: NSIS を /S で`, async () => {
    const steps = await stepsFor("paseo", "win32", arch);
    assert.equal(steps[0].url, `https://github.com/getpaseo/paseo/releases/download/v0.10.3/Paseo-Setup-0.10.3-${arch}.exe`);
    assert.deepEqual(steps[1], { kind: "spawn", cmd: `{tmp}\\Paseo-Setup-0.10.3-${arch}.exe`, args: ["/S"], elevate: false });
  });
}

test("fixPath（mac）: 見つかったコマンドを ~/.local/bin へ symlink し、PATH は ~/.local/bin だけ", async () => {
  const steps = await stepsFor("codex", "darwin", "arm64", { mode: "fixPath", foundPath: "/opt/homebrew/bin/codex" });
  assert.deepEqual(steps, [
    { kind: "symlink", target: "/opt/homebrew/bin/codex", link: "/Users/u/.local/bin/codex" },
    { kind: "ensurePath", dir: "/Users/u/.local/bin" },
  ]);
});

test("fixPath（mac）: すでに ~/.local/bin にあるなら PATH を足すだけ", async () => {
  const steps = await stepsFor("claude-code", "darwin", "arm64", { mode: "fixPath", foundPath: "/Users/u/.local/bin/claude" });
  assert.deepEqual(steps, [{ kind: "ensurePath", dir: "/Users/u/.local/bin" }]);
});

test("fixPath（Windows）: symlink は使わず、見つかった場所を PATH に足す", async () => {
  const steps = await stepsFor("claude-code", "win32", "x64", { mode: "fixPath", foundPath: "D:\\tools\\claude.exe" });
  assert.deepEqual(steps, [
    { kind: "ensurePath", dir: "D:\\tools" },
    { kind: "ensurePath", dir: "C:\\Users\\u\\.local\\bin" },
  ]);
});

test("latest-mac.yml を読み、最新が取れなければ固定版に戻る", async () => {
  const yml = `version: 9.9.9
files:
  - url: Paseo-9.9.9-arm64.zip
    sha512: AAA==
    size: 10
  - url: Paseo-9.9.9-x64.zip
    sha512: BBB==
    size: 20
path: Paseo-9.9.9-arm64.zip
sha512: AAA==
releaseDate: '2026-10-02T12:37:43.000Z'
`;
  assert.deepEqual(parseUpdaterYaml(yml), {
    version: "9.9.9",
    files: [
      { url: "Paseo-9.9.9-arm64.zip", sha512: "AAA==", size: 10 },
      { url: "Paseo-9.9.9-x64.zip", sha512: "BBB==", size: 20 },
    ],
  });
  const install = items.get("paseo").platforms.darwin.install;
  const ctx = ctxFor("darwin", "x64");
  const live = await resolveRelease(install, ctx, { fetchText: async () => yml });
  assert.equal(live.url, "https://github.com/getpaseo/paseo/releases/download/v9.9.9/Paseo-9.9.9-x64.zip");
  assert.equal(live.hash.digest, "BBB==");
  const down = await resolveRelease(install, ctx, { fetchText: async () => { throw new Error("offline"); } });
  assert.equal(down.pinned, true);
  assert.equal(down.version, "0.10.3");
  assert.equal(down.resolveError, "offline");
});
