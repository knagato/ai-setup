// カタログ（catalog/*.json）の読み込みと検証。
// ツールを増やすときは JSON を1つ足すだけで済むようにし、手順の組み立ては strategies/ に任せる。
// 項目は種類ごとのグループ（catalog/groups.json）に属し、画面ではグループごとに選ばせる。

const fs = require("node:fs");
const path = require("node:path");
const { isAllowedUrl } = require("./download");
const strategies = require("./strategies");

const CATALOG_DIR = path.join(__dirname, "..", "..", "catalog");
const GROUPS_FILE = "groups.json";
const TIERS = ["recommended", "optional"]; // recommended は最初から選んでおく
const OSES = ["darwin", "win32"];
// 完了画面での案内（launch: アプリを開くボタン / terminal: 打つコマンド / start: 使い始める前に一度開くアプリ）
const DONE_KINDS = ["launch", "terminal", "start"];
const POST_INSTALL_KINDS = ["ensurePath", "cliShim", "linkBin", "brewShellenv"];

function loadCatalog(dir = CATALOG_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== GROUPS_FILE)
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// グループは並べた順に画面に出す。atLeastOne のグループは、どれか1つが入っているか選ばれていないと先に進めない
function loadGroups(dir = CATALOG_DIR) {
  return JSON.parse(fs.readFileSync(path.join(dir, GROUPS_FILE), "utf8"));
}

// 問題を文字列の配列で返す（空なら正常）
function validateCatalog(items, groups = loadGroups()) {
  const errors = [];
  const ids = new Set();
  const groupIds = new Set();
  for (const g of groups) {
    for (const key of ["id", "name", "description"]) {
      if (g[key] == null) errors.push(`グループ ${g.id ?? "(id なし)"}: ${key} がありません`);
    }
    if (groupIds.has(g.id)) errors.push(`グループ ${g.id}: id が重複しています`);
    if (g.done != null && !DONE_KINDS.includes(g.done)) errors.push(`グループ ${g.id}: done が不正です（${g.done}）`);
    groupIds.add(g.id);
    const members = items.filter((i) => i.group === g.id);
    if (!members.length) errors.push(`グループ ${g.id}: 項目がありません`);
    // どれも入れられない OS があると、その OS では先に進めなくなる
    for (const os of g.atLeastOne ? OSES : []) {
      if (!members.some((i) => i.platforms?.[os])) errors.push(`グループ ${g.id}: ${os} で選べる項目がありません`);
    }
  }
  for (const item of items) {
    const where = item.id ?? "(id なし)";
    for (const key of ["id", "name", "tier", "group", "description", "platforms"]) {
      if (item[key] == null) errors.push(`${where}: ${key} がありません`);
    }
    if (ids.has(item.id)) errors.push(`${where}: id が重複しています`);
    ids.add(item.id);
    if (item.tier && !TIERS.includes(item.tier)) errors.push(`${where}: tier が不正です（${item.tier}）`);
    if (item.group && !groupIds.has(item.group)) errors.push(`${where}: 未知のグループです（${item.group}）`);

    for (const [os, p] of Object.entries(item.platforms ?? {})) {
      if (!OSES.includes(os)) errors.push(`${where}: 未知の OS です（${os}）`);
      if (!p.detect) errors.push(`${where}/${os}: detect がありません`);
      const s = p.install?.strategy;
      if (!strategies[s]) errors.push(`${where}/${os}: 未知の strategy です（${s}）`);
      if (p.install?.url && !isAllowedUrl(p.install.url)) errors.push(`${where}/${os}: 許可していない URL です（${p.install.url}）`);
      // 版のテンプレート（{version} など）は仮の値で埋めて確かめる
      for (const key of ["url", "checksums", "appcast"]) {
        const t = p.install?.release?.[key];
        if (t && !isAllowedUrl(t.replace(/\{\w+\}/g, "x"))) errors.push(`${where}/${os}: 許可していない URL です（${t}）`);
      }
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
    for (const a of item.after ?? []) {
      if (!ids.has(a)) errors.push(`${item.id}: after に未知の id があります（${a}）`);
    }
  }
  try {
    installOrder(items, [...ids]);
  } catch (e) {
    errors.push(e.message);
  }
  return errors;
}

// 選んだ id を、依存（dependsOn）を先に並べた順にする。依存先も選択に含める。
// after（両方選ばれていたら先にやるもの）も、選ばれているときだけ先に並べる
function installOrder(items, selected) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const chosen = new Set(selected);
  const order = [];
  const state = new Map(); // id -> "visiting" | "done"
  const visit = (id, chain) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") throw new Error(`dependsOn が循環しています: ${[...chain, id].join(" → ")}`);
    const item = byId.get(id);
    if (!item) throw new Error(`未知の id です: ${id}`);
    state.set(id, "visiting");
    for (const dep of item.dependsOn ?? []) visit(dep, [...chain, id]);
    for (const a of item.after ?? []) if (chosen.has(a)) visit(a, [...chain, id]);
    state.set(id, "done");
    order.push(id);
  };
  const sorted = [...selected].sort((a, b) => (byId.get(a)?.order ?? 0) - (byId.get(b)?.order ?? 0));
  for (const id of sorted) visit(id, []);
  return order;
}

module.exports = { loadCatalog, loadGroups, validateCatalog, installOrder, CATALOG_DIR, TIERS };
