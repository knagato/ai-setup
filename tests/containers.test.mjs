// アプリを動かす箱（Docker Desktop・OrbStack）: Sparkle の appcast の読み方、dmg の手順、動く macOS の版。ネットには繋がない。
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadCatalog } = require("../src/core/catalog.js");
const { makeContext } = require("../src/core/platform.js");
const { resolveRelease, parseAppcast } = require("../src/core/resolvers.js");
const { planItem } = require("../src/core/plan.js");
const { detectItem } = require("../src/core/detect.js");

const items = new Map(loadCatalog().map((i) => [i.id, i]));
const mac = (arch = "arm64") => makeContext({ os: "darwin", arch, home: "/Users/u", osMajor: 15 });
const install = (id) => items.get(id).platforms.darwin.install;

// Docker は版を enclosure の属性に、OrbStack は子要素に書く。差分（deltas）の enclosure は読まない
const dockerAppcast = `<rss><channel><item><title>Version 4.96.0 (250000)</title>
  <enclosure url="https://desktop.docker.com/mac/main/arm64/250000/Docker.dmg" sparkle:version="250000" sparkle:shortVersionString="4.96.0" length="600" type="application/octet-stream"></enclosure>
  <sparkle:deltas><enclosure url="https://desktop.docker.com/mac/main/arm64/250000/Docker-1.delta" sparkle:version="250000" length="1"></enclosure></sparkle:deltas>
</item></channel></rss>`;
const orbAppcast = `<rss><channel>
<item><sparkle:channel>beta</sparkle:channel><sparkle:version>22000</sparkle:version><sparkle:shortVersionString>2.3.0</sparkle:shortVersionString>
  <enclosure url="https://cdn-updates.orbstack.dev/arm64/OrbStack_v2.3.0_22000_arm64.dmg" length="5" sparkle:edSignature="BETA" /></item>
<item><sparkle:channel>stable</sparkle:channel><sparkle:version>21500</sparkle:version><sparkle:shortVersionString>2.2.5</sparkle:shortVersionString>
  <sparkle:deltas><enclosure url="https://cdn-updates.orbstack.dev/arm64/x.delta" sparkle:deltaFrom="1" length="1" sparkle:edSignature="DELTA" /></sparkle:deltas>
  <enclosure url="https://cdn-updates.orbstack.dev/arm64/OrbStack_v2.2.5_21500_arm64.dmg" length="4" sparkle:edSignature="STABLE" /></item>
</channel></rss>`;

test("parseAppcast: 属性に書く形と子要素に書く形の両方を読み、差分は飛ばす", () => {
  assert.deepEqual(parseAppcast(dockerAppcast), [
    { channel: null, version: "4.96.0", build: "250000", url: "https://desktop.docker.com/mac/main/arm64/250000/Docker.dmg", length: 600, edSignature: undefined },
  ]);
  const orb = parseAppcast(orbAppcast);
  assert.equal(orb[1].url, "https://cdn-updates.orbstack.dev/arm64/OrbStack_v2.2.5_21500_arm64.dmg");
  assert.equal(orb[1].edSignature, "STABLE");
});

test("Docker Desktop: appcast でビルド番号を知り、同じビルドの checksums.txt の sha256 で照合する", async () => {
  const io = {
    fetchText: async (u) => {
      if (u.endsWith("appcast.xml")) return (assert.equal(u, "https://desktop.docker.com/mac/main/amd64/appcast.xml"), dockerAppcast.replaceAll("arm64", "amd64"));
      assert.equal(u, "https://desktop.docker.com/mac/main/amd64/250000/checksums.txt");
      return `${"a".repeat(64)} *Docker.dmg\n`;
    },
  };
  const r = await resolveRelease(install("docker-desktop"), mac("x64"), io);
  assert.deepEqual(r, {
    version: "4.96.0",
    build: "250000",
    url: "https://desktop.docker.com/mac/main/amd64/250000/Docker.dmg",
    size: 600,
    hash: { algo: "sha256", digest: "a".repeat(64), encoding: "hex" },
  });
});

test("OrbStack: stable の最初の項目を選び、appcast の ed25519 の署名とアプリの公開鍵で照合する", async () => {
  const r = await resolveRelease(install("orbstack"), mac(), { fetchText: async () => orbAppcast });
  assert.equal(r.version, "2.2.5");
  assert.deepEqual(r.hash, { algo: "ed25519", publicKey: install("orbstack").release.edKey, signature: "STABLE" });
});

for (const [id, arch, url] of [
  ["docker-desktop", "x64", "https://desktop.docker.com/mac/main/amd64/242831/Docker.dmg"],
  ["orbstack", "x64", "https://cdn-updates.orbstack.dev/amd64/OrbStack_v2.2.4_21120_amd64.dmg"],
  ["orbstack", "arm64", "https://cdn-updates.orbstack.dev/arm64/OrbStack_v2.2.4_21120_arm64.dmg"],
]) {
  test(`${id}（mac ${arch}）: 固定版も照合でき、dmg をマウントして確かめてから置き、マウントを外す`, async () => {
    const ctx = mac(arch);
    const item = items.get(id);
    const release = await resolveRelease(item.platforms.darwin.install, ctx, { offline: true });
    assert.equal(release.url, url);
    assert.ok(release.hash.digest || release.hash.signature);
    const steps = planItem(item, ctx, release).steps;
    const app = item.platforms.darwin.install.appName;
    assert.deepEqual(steps.map((s) => s.kind), ["download", "mountDmg", "verifyMacApp", "installMacApp", "unmountDmg"]);
    assert.deepEqual(steps[1], { kind: "mountDmg", dmg: "{tmp}/app.dmg", mountpoint: "{tmp}/mnt" });
    assert.deepEqual(steps[2], { kind: "verifyMacApp", app: `{tmp}/mnt/${app}`, teamId: item.platforms.darwin.install.teamId });
  });
}

test("Docker Desktop は /Applications にしか置かない（OrbStack は ~/Applications に逃がせる）", async () => {
  const plan = async (id) => planItem(items.get(id), mac(), await resolveRelease(install(id), mac(), { offline: true })).steps;
  assert.equal((await plan("docker-desktop"))[3].systemOnly, true);
  assert.equal((await plan("orbstack"))[3].systemOnly, undefined);
});

test("macOS 14 より古い Mac では選べない", async () => {
  const envInfo = { loginPath: [], searchPath: [] };
  const old = makeContext({ os: "darwin", arch: "arm64", home: "/nonexistent", osMajor: 13 });
  for (const id of ["docker-desktop", "orbstack"]) {
    const d = await detectItem(items.get(id), old, envInfo);
    assert.equal(d.state, "unsupported");
    assert.match(d.detail, /macOS 14 以降が必要です（この Mac は macOS 13）/);
  }
  assert.equal((await detectItem(items.get("orbstack"), mac(), envInfo)).state, "missing");
});
