// AI エージェント（Pi・OpenCode・Grok・Hermes）と画面から使うアプリ（Orca・T3 Code）の手順と版の解決。ネットには繋がない。
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadCatalog, installOrder } = require("../src/core/catalog.js");
const { makeContext } = require("../src/core/platform.js");
const { resolveRelease } = require("../src/core/resolvers.js");
const { planItem } = require("../src/core/plan.js");
const { childEnv } = require("../src/core/env.js");

const catalog = loadCatalog();
const items = new Map(catalog.map((i) => [i.id, i]));
const mac = (arch = "arm64") => makeContext({ os: "darwin", arch, home: "/Users/u" });

async function planFor(id, arch = "arm64", io = { offline: true }) {
  const ctx = mac(arch);
  const item = items.get(id);
  const release = await resolveRelease(item.platforms.darwin.install, ctx, io);
  return { release, steps: planItem(item, ctx, release).steps };
}

test("Pi: Node を先に入れ、npm で決まった場所に入れてリンクする", async () => {
  assert.deepEqual(installOrder(catalog, ["pi"]), ["node", "pi"]);
  const { steps } = await planFor("pi");
  assert.deepEqual(steps.slice(0, 2), [
    { kind: "spawn", cmd: "npm", args: ["install", "--global", "--prefix", "/Users/u/.local/share/ai-setup/npm-global", "@earendil-works/pi-coding-agent"] },
    { kind: "symlink", target: "/Users/u/.local/share/ai-setup/npm-global/bin/pi", link: "/Users/u/.local/bin/pi" },
  ]);
});

for (const arch of ["arm64", "x64"]) {
  test(`OpenCode（mac ${arch}）: zip の中の1ファイルを版ごとのフォルダに置き、~/.local/bin をリンクする`, async () => {
    const { steps } = await planFor("opencode", arch);
    const fb = items.get("opencode").platforms.darwin.install.fallback;
    assert.deepEqual(steps.slice(0, 5), [
      {
        kind: "download",
        url: `https://github.com/anomalyco/opencode/releases/download/v${fb.version}/opencode-darwin-${arch}.zip`,
        dest: `{tmp}/opencode-darwin-${arch}.zip`,
        hash: { algo: "sha256", digest: fb.sha256[arch], encoding: "hex" },
        size: undefined,
      },
      { kind: "unzip", archive: `{tmp}/opencode-darwin-${arch}.zip`, dest: "{tmp}/x" },
      { kind: "installDir", src: "{tmp}/x", dest: `/Users/u/.local/share/ai-setup/opencode/${fb.version}` },
      { kind: "symlink", target: `/Users/u/.local/share/ai-setup/opencode/${fb.version}`, link: "/Users/u/.local/share/ai-setup/opencode/current" },
      { kind: "symlink", target: "/Users/u/.local/share/ai-setup/opencode/current/opencode", link: "/Users/u/.local/bin/opencode" },
    ]);
  });
}

test("OpenCode: releases/latest の転送先から版を読み、sha256 は API のアセットの digest から引く", async () => {
  const digest = "c".repeat(64);
  const io = {
    finalUrl: async () => "https://github.com/anomalyco/opencode/releases/tag/v1.20.0",
    fetchText: async (u) => {
      assert.equal(u, "https://api.github.com/repos/anomalyco/opencode/releases/tags/v1.20.0");
      return JSON.stringify({ assets: [{ name: "opencode-darwin-x64.zip", digest: `sha256:${"d".repeat(64)}` }, { name: "opencode-darwin-arm64.zip", digest: `sha256:${digest}` }] });
    },
  };
  const r = await resolveRelease(items.get("opencode").platforms.darwin.install, mac(), io);
  assert.equal(r.version, "1.20.0");
  assert.equal(r.url, "https://github.com/anomalyco/opencode/releases/download/v1.20.0/opencode-darwin-arm64.zip");
  assert.deepEqual(r.hash, { algo: "sha256", digest, encoding: "hex" });
  // digest が無ければ固定版に戻る
  const none = await resolveRelease(items.get("opencode").platforms.darwin.install, mac(), { ...io, fetchText: async () => '{"assets":[]}' });
  assert.equal(none.pinned, true);
});

test("Grok（mac）: シェル設定も ~/.local/bin も触らせず、grok だけを ~/.local/bin へリンクする", async () => {
  const { steps } = await planFor("grok");
  assert.equal(steps[0].url, "https://x.ai/cli/install.sh");
  // SHELL=/bin/sh だとシェル設定に書かない。PATH に ~/.local/bin が無いと、agent まで勝手にリンクしない
  assert.deepEqual(steps[1].env, { SHELL: "/bin/sh", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" });
  assert.deepEqual(steps[2], { kind: "symlink", target: "/Users/u/.grok/bin/grok", link: "/Users/u/.local/bin/grok" });
  const ctx = mac();
  assert.equal(childEnv(ctx, { searchPath: ["/Users/u/.local/bin", "/usr/bin"] }, steps[1].env).PATH, "/usr/bin:/bin:/usr/sbin:/sbin");
  assert.equal(childEnv(ctx, { searchPath: ["/Users/u/.local/bin", "/usr/bin"] }).PATH, "/Users/u/.local/bin:/usr/bin");
});

test("Hermes（mac）: Git を先に入れ、シェル設定を退避してから非対話で流す", async () => {
  assert.deepEqual(installOrder(catalog, ["hermes"]), ["git", "hermes"]);
  const { steps } = await planFor("hermes");
  assert.equal(steps[0].kind, "backup");
  assert.ok(steps[0].files.includes("/Users/u/.zshrc") && steps[0].files.includes("/Users/u/.zprofile"));
  assert.equal(steps[1].kind, "download");
  assert.deepEqual(steps[2].args, ["{tmp}/install.sh", "--non-interactive", "--skip-browser", "--skip-computer-use"]);
  assert.equal(steps[2].timeoutMs, 45 * 60 * 1000);
});

for (const [arch, file] of [["arm64", "Orca-1.4.226-arm64-mac.zip"], ["x64", "Orca-1.4.226-mac.zip"]]) {
  test(`Orca（mac ${arch}）: arch ごとのファイル名で取り、署名を確かめて置き、orca をリンクする`, async () => {
    const { steps } = await planFor("orca", arch);
    assert.equal(steps[0].url, `https://github.com/stablyai/orca/releases/download/v1.4.226/${file}`);
    assert.deepEqual(steps[2], { kind: "verifyMacApp", app: "{tmp}/app/Orca.app", teamId: "6CX3WHS9HZ" });
    assert.deepEqual(steps[4], { kind: "symlink", target: "{appPath}/Contents/Resources/bin/orca", link: "/Users/u/.local/bin/orca" });
  });
}

test("Orca: latest-mac.yml から、x64 は名前に arch の入らない zip を選ぶ", async () => {
  const yml = `version: 1.5.0\nfiles:\n  - url: Orca-1.5.0-mac.zip\n    sha512: XX\n    size: 3\n  - url: Orca-1.5.0-arm64-mac.zip\n    sha512: AA\n    size: 2\n`;
  const r = await resolveRelease(items.get("orca").platforms.darwin.install, mac("x64"), { fetchText: async () => yml });
  assert.equal(r.url, "https://github.com/stablyai/orca/releases/download/v1.5.0/Orca-1.5.0-mac.zip");
  assert.equal(r.hash.digest, "XX");
});

test("T3 Code（mac）: (Alpha) の付いたアプリ名のまま確かめて置く", async () => {
  const { steps } = await planFor("t3code", "x64");
  assert.equal(steps[0].url, "https://github.com/pingdotgg/t3code/releases/download/v0.0.45/T3-Code-0.0.45-x64.zip");
  assert.deepEqual(steps[2], { kind: "verifyMacApp", app: "{tmp}/app/T3 Code (Alpha).app", teamId: "ARK85ZXQ4Z" });
  assert.deepEqual(steps[3], { kind: "installMacApp", src: "{tmp}/app/T3 Code (Alpha).app", name: "T3 Code (Alpha).app" });
});

test("Windows: Grok・Orca・T3 Code は入れられ、Pi・OpenCode・Hermes は準備中", () => {
  for (const id of ["grok", "orca", "t3code"]) assert.ok(items.get(id).platforms.win32, id);
  for (const id of ["pi", "opencode", "hermes"]) assert.ok(!items.get(id).platforms.win32 && items.get(id).unsupportedReason.win32, id);
});
