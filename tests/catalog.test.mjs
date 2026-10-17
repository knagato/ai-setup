// カタログの検証（スキーマ・依存・URL の許可リスト）と、依存順の並べ替え。
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadCatalog, loadGroups, validateCatalog, installOrder } = require("../src/core/catalog.js");

test("同梱のカタログは検証を通る", () => {
  assert.deepEqual(validateCatalog(loadCatalog()), []);
});

test("外せない項目は無く、AI エージェントはどれか1つでよい。おすすめは Claude Code・Codex と Paseo", () => {
  const items = loadCatalog();
  assert.ok(items.every((i) => i.tier !== "required"));
  const agent = loadGroups().find((g) => g.id === "agent");
  assert.equal(agent.atLeastOne, true);
  const ids = (group, tier) => items.filter((i) => i.group === group && (!tier || i.tier === tier)).map((i) => i.id);
  assert.deepEqual(ids("agent"), ["claude-code", "codex", "pi", "opencode", "grok", "hermes"]);
  assert.deepEqual(ids("agent", "recommended"), ["claude-code", "codex"]);
  assert.deepEqual(ids("app"), ["paseo", "orca", "t3code"]);
  assert.deepEqual(ids("app", "recommended"), ["paseo"]);
  assert.deepEqual(ids("container"), ["docker-desktop", "orbstack"]);
  assert.deepEqual(ids("container", "recommended"), []);
});

const item = (id, extra = {}) => ({
  id,
  name: id,
  tier: "optional",
  group: "g",
  description: "x",
  platforms: { darwin: { detect: { command: id }, install: { strategy: "officialScript", url: "https://claude.ai/install.sh" } } },
  ...extra,
});

const groups = [{ id: "g", name: "g", description: "x" }];

test("問題を見つける", () => {
  const errors = validateCatalog([
    item("a", { tier: "required" }),
    item("f", { group: "nope" }),
    item("a"),
    item("b", { dependsOn: ["zzz"] }),
    item("g", { after: ["yyy"] }),
    item("c", { platforms: { darwin: { detect: {}, install: { strategy: "magic" } } } }),
    item("d", { platforms: { darwin: { detect: {}, install: { strategy: "officialScript", url: "https://evil.example/x.sh" } } } }),
    item("e", { platforms: { darwin: { detect: {}, install: { strategy: "officialScript", url: "http://claude.ai/install.sh" } } } }),
  ], groups);
  for (const want of ["tier が不正", "未知のグループです（nope）", "id が重複", "未知の id があります（zzz）", "after に未知の id があります（yyy）", "未知の strategy", "evil.example", "http://claude.ai"]) {
    assert.ok(errors.some((e) => e.includes(want)), `${want} を見つけられない: ${errors.join(" / ")}`);
  }
});

test("どれか1つ必要なグループで、選べる項目が無い OS を見つける", () => {
  const errors = validateCatalog([item("a"), item("b")], [{ id: "g", name: "g", description: "x", atLeastOne: true, done: "open" }, { id: "empty", name: "e", description: "x" }]);
  assert.ok(errors.some((e) => e.includes("グループ g: win32 で選べる項目がありません")), errors.join(" / "));
  assert.ok(!errors.some((e) => e.includes("darwin")), errors.join(" / "));
  assert.ok(errors.some((e) => e.includes("グループ empty: 項目がありません")), errors.join(" / "));
  assert.ok(errors.some((e) => e.includes("グループ g: done が不正です（open）")), errors.join(" / "));
});

test("依存を先に並べ、循環を見つける", () => {
  const items = [item("node", { order: 1 }), item("pnpm", { order: 2, dependsOn: ["node"] }), item("app", { order: 0 })];
  assert.deepEqual(installOrder(items, ["pnpm", "app"]), ["app", "node", "pnpm"]);
  const loop = [item("x", { dependsOn: ["y"] }), item("y", { dependsOn: ["x"] })];
  assert.throws(() => installOrder(loop, ["x"]), /循環/);
});
