// カタログの検証（スキーマ・依存・URL の許可リスト）と、依存順の並べ替え。
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadCatalog, validateCatalog, installOrder } = require("../src/core/catalog.js");

test("同梱のカタログは検証を通る", () => {
  assert.deepEqual(validateCatalog(loadCatalog()), []);
});

test("必須の3項目がある", () => {
  const required = loadCatalog().filter((i) => i.tier === "required").map((i) => i.id);
  assert.deepEqual(required, ["claude-code", "codex", "paseo"]);
});

const item = (id, extra = {}) => ({
  id,
  name: id,
  tier: "optional",
  description: "x",
  platforms: { darwin: { detect: { command: id }, install: { strategy: "officialScript", url: "https://claude.ai/install.sh" } } },
  ...extra,
});

test("問題を見つける", () => {
  const errors = validateCatalog([
    item("a", { tier: "nope" }),
    item("a"),
    item("b", { dependsOn: ["zzz"] }),
    item("c", { platforms: { darwin: { detect: {}, install: { strategy: "magic" } } } }),
    item("d", { platforms: { darwin: { detect: {}, install: { strategy: "officialScript", url: "https://evil.example/x.sh" } } } }),
    item("e", { platforms: { darwin: { detect: {}, install: { strategy: "officialScript", url: "http://claude.ai/install.sh" } } } }),
  ]);
  for (const want of ["tier が不正", "id が重複", "未知の id があります（zzz）", "未知の strategy", "evil.example", "http://claude.ai"]) {
    assert.ok(errors.some((e) => e.includes(want)), `${want} を見つけられない: ${errors.join(" / ")}`);
  }
});

test("依存を先に並べ、循環を見つける", () => {
  const items = [item("node", { order: 1 }), item("pnpm", { order: 2, dependsOn: ["node"] }), item("app", { order: 0 })];
  assert.deepEqual(installOrder(items, ["pnpm", "app"]), ["app", "node", "pnpm"]);
  const loop = [item("x", { dependsOn: ["y"] }), item("y", { dependsOn: ["x"] })];
  assert.throws(() => installOrder(loop, ["x"]), /循環/);
});
