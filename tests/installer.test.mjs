// 実行の順番: OS のダイアログで入れるもの（Git）は裏で待ち、それに依存するものは最後に回す。
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { schedule } = require("../src/core/installer.js");
const { installOrder, loadCatalog } = require("../src/core/catalog.js");
const { makeContext } = require("../src/core/platform.js");

const mac = makeContext({ os: "darwin", home: "/Users/x" });
const win = makeContext({ os: "win32", home: "C:\\Users\\x" });

function item(id, strategy, dependsOn = []) {
  return { id, dependsOn, platforms: { darwin: { install: { strategy } } } };
}

test("schedule: Git は裏で、依存するものは（間接的なものも）後ろに回す", () => {
  const items = [
    item("claude", "officialScript"),
    item("git", "xcodeClt"),
    item("hermes", "officialScript", ["git"]),
    item("plugin", "officialScript", ["hermes"]),
    item("paseo", "macAppZip"),
  ];
  const byId = new Map(items.map((i) => [i.id, i]));
  const { background, sequence } = schedule(["claude", "git", "hermes", "plugin", "paseo"], byId, mac);
  assert.deepEqual(background, ["git"]);
  assert.deepEqual(sequence, ["claude", "paseo", "hermes", "plugin"]);
});

test("schedule: パスワードを聞くもの（askpass）も裏で。after は待つ側を後ろに回す", () => {
  const items = [
    { ...item("brew", "officialScript"), platforms: { darwin: { install: { strategy: "officialScript", askpass: "pw" } } } },
    { ...item("git", "xcodeClt"), after: ["brew"] },
    item("node", "archiveBinary"),
    { ...item("tool", "officialScript"), after: ["brew"] },
  ];
  const byId = new Map(items.map((i) => [i.id, i]));
  const { background, sequence } = schedule(["brew", "git", "node", "tool"], byId, mac);
  assert.deepEqual(background, ["brew", "git"]);
  assert.deepEqual(sequence, ["node", "tool"]);
});

test("installOrder: after は選ばれているときだけ先に並べる（依存で先に呼ばれても）", () => {
  const items = [
    { ...item("hermes", "officialScript", ["git"]), order: 28 },
    { ...item("brew", "officialScript"), order: 38 },
    { ...item("git", "xcodeClt"), order: 40, after: ["brew"] },
  ];
  assert.deepEqual(installOrder(items, ["hermes", "brew", "git"]), ["brew", "git", "hermes"]);
  assert.deepEqual(installOrder(items, ["hermes"]), ["git", "hermes"]);
});

test("schedule: 本物のカタログで、Homebrew と Git を選んでもほかの項目は待たずに進む", () => {
  const items = loadCatalog();
  const byId = new Map(items.map((i) => [i.id, i]));
  const ids = items.filter((i) => i.platforms.darwin).map((i) => i.id);
  const order = installOrder(items, ids);
  const { background, sequence } = schedule(order, byId, mac);
  assert.deepEqual(background, ["homebrew", "git"]);
  assert.deepEqual([...background, ...sequence].sort(), [...order].sort());
  // 依存先が先に来る（裏で待つものは最初に始まる）
  const pos = new Map([...background, ...sequence].map((id, i) => [id, background.includes(id) ? -1 : i]));
  for (const id of sequence) for (const d of byId.get(id).dependsOn ?? []) assert.ok(pos.get(d) < pos.get(id), `${d} → ${id}`);
  assert.ok(order.indexOf("homebrew") < order.indexOf("git"), "Git は Homebrew の後");
});

test("schedule: Windows では Git を扱わないので、裏で待つものは無い", () => {
  const items = loadCatalog();
  const byId = new Map(items.map((i) => [i.id, i]));
  const order = installOrder(items, items.filter((i) => i.platforms.win32).map((i) => i.id));
  assert.deepEqual(schedule(order, byId, win).background, []);
});
