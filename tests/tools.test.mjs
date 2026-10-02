// M2 の道具（Git・gh・Node・pnpm・Tailscale・Composio）の手順と版の解決。ネットには繋がない。
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadCatalog } = require("../src/core/catalog.js");
const { makeContext } = require("../src/core/platform.js");
const { resolveRelease, findSha256 } = require("../src/core/resolvers.js");
const { planItem } = require("../src/core/plan.js");

const items = new Map(loadCatalog().map((i) => [i.id, i]));
const mac = (arch = "arm64") => makeContext({ os: "darwin", arch, home: "/Users/u" });

async function planFor(id, arch = "arm64", io = { offline: true }) {
  const ctx = mac(arch);
  const item = items.get(id);
  const release = await resolveRelease(item.platforms.darwin.install, ctx, io);
  return { release, steps: planItem(item, ctx, release).steps };
}

test("findSha256: 一覧から名前で引く・hex だけのファイル", () => {
  const sums = "aaa\nbed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057  node-v24.21.0-darwin-arm64.tar.gz\n";
  assert.equal(findSha256(sums, "https://x/node-v24.21.0-darwin-arm64.tar.gz"), "bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057");
  assert.equal(findSha256(sums, "https://x/other.tar.gz"), null);
  assert.equal(findSha256("9331CEF28109464864CD90B2A91FD0CDAC09B9B1355D2B7F84DE1788863FC2F2\n", "https://x/a.zip"), "9331cef28109464864cd90b2a91fd0cdac09b9b1355d2b7f84de1788863fc2f2");
});

for (const [arch, garch] of [["arm64", "arm64"], ["x64", "amd64"]]) {
  test(`gh（mac ${arch}）: zip を版ごとのフォルダに置き、current と ~/.local/bin をリンクする`, async () => {
    const { steps } = await planFor("gh", arch);
    const tmpRoot = `{tmp}/x/gh_2.102.0_macOS_${garch}`;
    assert.deepEqual(steps, [
      {
        kind: "download",
        url: `https://github.com/cli/cli/releases/download/v2.102.0/gh_2.102.0_macOS_${garch}.zip`,
        dest: `{tmp}/gh_2.102.0_macOS_${garch}.zip`,
        hash: { algo: "sha256", digest: items.get("gh").platforms.darwin.install.fallback.sha256[arch], encoding: "hex" },
        size: undefined,
      },
      { kind: "unzip", archive: `{tmp}/gh_2.102.0_macOS_${garch}.zip`, dest: "{tmp}/x" },
      { kind: "installDir", src: tmpRoot, dest: "/Users/u/.local/share/ai-setup/gh/2.102.0" },
      { kind: "symlink", target: "/Users/u/.local/share/ai-setup/gh/2.102.0", link: "/Users/u/.local/share/ai-setup/gh/current" },
      { kind: "symlink", target: "/Users/u/.local/share/ai-setup/gh/current/bin/gh", link: "/Users/u/.local/bin/gh" },
      { kind: "ensurePath", dir: "/Users/u/.local/bin" },
    ]);
  });
}

test("gh: releases/latest の転送先から版を読み、checksums からハッシュを引く", async () => {
  const io = {
    finalUrl: async (u) => (assert.equal(u, "https://github.com/cli/cli/releases/latest"), "https://github.com/cli/cli/releases/tag/v2.200.1"),
    fetchText: async (u) => {
      assert.equal(u, "https://github.com/cli/cli/releases/download/v2.200.1/gh_2.200.1_checksums.txt");
      return `${"b".repeat(64)}  gh_2.200.1_macOS_amd64.zip\n${"a".repeat(64)}  gh_2.200.1_macOS_arm64.zip\n`;
    },
  };
  const r = await resolveRelease(items.get("gh").platforms.darwin.install, mac("x64"), io);
  assert.equal(r.version, "2.200.1");
  assert.equal(r.url, "https://github.com/cli/cli/releases/download/v2.200.1/gh_2.200.1_macOS_amd64.zip");
  assert.equal(r.hash.digest, "b".repeat(64));
  assert.equal(r.arch, "amd64");
});

test("Node: 一覧の先頭の LTS を選び、node・npm・npx をリンクする", async () => {
  const io = {
    fetchText: async (u) => {
      if (u === "https://nodejs.org/dist/index.json") {
        return JSON.stringify([{ version: "v25.1.0", lts: false }, { version: "v24.30.0", lts: "Krypton" }, { version: "v22.1.0", lts: "Jod" }]);
      }
      assert.equal(u, "https://nodejs.org/dist/v24.30.0/SHASUMS256.txt");
      return `${"c".repeat(64)}  node-v24.30.0-darwin-arm64.tar.gz\n`;
    },
  };
  const { release, steps } = await planFor("node", "arm64", io);
  assert.equal(release.version, "24.30.0");
  assert.equal(steps[1].kind, "untar");
  assert.equal(steps[2].src, "{tmp}/x/node-v24.30.0-darwin-arm64");
  assert.deepEqual(
    steps.filter((s) => s.kind === "symlink").map((s) => s.link),
    ["/Users/u/.local/share/ai-setup/node/current", "/Users/u/.local/bin/node", "/Users/u/.local/bin/npm", "/Users/u/.local/bin/npx"],
  );
});

test("pnpm: Node を先に入れ、npm で決まった場所に入れてリンクする", async () => {
  assert.deepEqual(items.get("pnpm").dependsOn, ["node"]);
  const { steps } = await planFor("pnpm");
  assert.deepEqual(steps, [
    { kind: "spawn", cmd: "npm", args: ["install", "--global", "--prefix", "/Users/u/.local/share/ai-setup/npm-global", "pnpm"] },
    { kind: "symlink", target: "/Users/u/.local/share/ai-setup/npm-global/bin/pnpm", link: "/Users/u/.local/bin/pnpm" },
    { kind: "symlink", target: "/Users/u/.local/share/ai-setup/npm-global/bin/pnpx", link: "/Users/u/.local/bin/pnpx" },
    { kind: "ensurePath", dir: "/Users/u/.local/bin" },
  ]);
});

test("Git（mac）: Xcode のコマンドライン・ツール。管理者パスワードの印が付く", async () => {
  const { steps } = await planFor("git");
  assert.deepEqual(steps, [{ kind: "xcodeClt" }]);
  assert.equal(planItem(items.get("git"), mac(), null).admin, true);
});

test("Tailscale（mac）: ユニバーサルの zip を確かめて /Applications に置く", async () => {
  const io = {
    fetchText: async (u) => {
      if (u === "https://pkgs.tailscale.com/stable/?mode=json") return JSON.stringify({ MacZipsVersion: "1.200.0" });
      assert.equal(u, "https://pkgs.tailscale.com/stable/Tailscale-1.200.0-macos.zip.sha256");
      return `${"d".repeat(64)}\n`;
    },
  };
  for (const arch of ["arm64", "x64"]) {
    const { steps } = await planFor("tailscale", arch, io);
    assert.deepEqual(steps.map((s) => s.kind), ["download", "unzip", "verifyMacApp", "installMacApp"]);
    assert.equal(steps[0].url, "https://pkgs.tailscale.com/stable/Tailscale-1.200.0-macos.zip");
    assert.deepEqual(steps[0].hash, { algo: "sha256", digest: "d".repeat(64), encoding: "hex" });
    assert.equal(steps[2].teamId, "W5364U7YZB");
  }
});

test("Composio（mac）: シェル設定とプラグインは自分でやらせない", async () => {
  const { steps } = await planFor("composio");
  assert.equal(steps[0].url, "https://composio.dev/install");
  assert.deepEqual(steps[1].env, { COMPOSIO_INSTALL_SHELL: "none", COMPOSIO_INSTALL_PLUGINS: "0" });
});

test("M2 の道具は Windows では準備中（Composio はネイティブ版が無い）", () => {
  for (const id of ["git", "gh", "node", "pnpm", "tailscale", "composio"]) {
    assert.equal(items.get(id).platforms.win32, undefined, id);
    assert.ok(items.get(id).unsupportedReason.win32, id);
  }
});
