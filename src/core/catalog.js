// カタログ（catalog/*.json）の読み込みと検証。
// ツールを増やすときは JSON を1つ足すだけで済むようにし、手順の組み立ては strategies/ に任せる。

const fs = require("node:fs");
const path = require("node:path");
const { isAllowedUrl } = require("./download");
const strategies = require("./strategies");

const CATALOG_DIR = path.join(__dirname, "..", "..", "catalog");
const TIERS = ["required", "recommended", "optional"];
const POST_INSTALL_KINDS = ["ensurePath", "cliShim"];

function loadCatalog(dir = CATALOG_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// 問題を文字列の配列で返す（空なら正常）
function validateCatalog(items) {
  const errors = [];
  const ids = new Set();
  for (const item of items) {
    const where = item.id ?? "(id なし)";
    for (const key of ["id", "name", "tier", "description", "platforms"]) {
      if (item[key] == null) errors.push(`${where}: ${key} がありません`);
    }
    if (ids.has(item.id)) errors.push(`${where}: id が重複しています`);
    ids.add(item.id);
    if (item.tier && !TIERS.includes(item.tier)) errors.push(`${where}: tier が不正です（${item.tier}）`);

    for (const [os, p] of Object.entries(item.platforms ?? {})) {
      if (!["darwin", "win32"].includes(os)) errors.push(`${where}: 未知の OS です（${os}）`);
      if (!p.detect) errors.push(`${where}/${os}: detect がありません`);
      const s = p.install?.strategy;
      if (!strategies[s]) errors.push(`${where}/${os}: 未知の strategy です（${s}）`);
      if (p.install?.url && !isAllowedUrl(p.install.url)) errors.push(`${where}/${os}: 許可していない URL です（${p.install.url}）`);
      for (const step of p.postInstall ?? []) {
        const kind = Object.keys(step)[0];
        if (!POST_INSTALL_KINDS.includes(kind)) errors.push(`${where}/${os}: 未知の postInstall です（${kind}）`);
      }
    }
  }
  for (const item of items) {
    for (const dep of item.dependsOn ?? []) {
      if (!ids.has(dep)) errors.push(`${item.id}: dependsOn に未知の id があります（${dep}）`);
    }
  }
  try {
    installOrder(items, [...ids]);
  } catch (e) {
    errors.push(e.message);
  }
  return errors;
}

// 選んだ id を、依存（dependsOn）を先に並べた順にする。依存先も選択に含める
function installOrder(items, selected) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const order = [];
  const state = new Map(); // id -> "visiting" | "done"
  const visit = (id, chain) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") throw new Error(`dependsOn が循環しています: ${[...chain, id].join(" → ")}`);
    const item = byId.get(id);
    if (!item) throw new Error(`未知の id です: ${id}`);
    state.set(id, "visiting");
    for (const dep of item.dependsOn ?? []) visit(dep, [...chain, id]);
    state.set(id, "done");
    order.push(id);
  };
  const sorted = [...selected].sort((a, b) => (byId.get(a)?.order ?? 0) - (byId.get(b)?.order ?? 0));
  for (const id of sorted) visit(id, []);
  return order;
}

module.exports = { loadCatalog, validateCatalog, installOrder, CATALOG_DIR, TIERS };
