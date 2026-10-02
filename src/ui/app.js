// 画面の進行: ようこそ → 環境チェック → 選択 → インストール → ログイン → 完了
const $ = (id) => document.getElementById(id);
const PAGES = ["welcome", "check", "select", "install", "login", "done"];
const TIER_LABEL = { required: "必須", recommended: "おすすめ", optional: "任意" };
const STATE_BADGE = {
  installed: ["入っています", "ok"],
  installedNotOnPath: ["設定だけ必要", "warn"],
  missing: ["未インストール", ""],
  unsupported: ["この OS は非対応", "bad"],
};

const state = {
  info: null,
  items: [], // detect:all の結果
  selected: new Set(),
  progress: new Map(), // id -> { status, error, lines[], received, total }
  lastIds: [],
  installing: false,
  update: null, // update:check の結果（新しい版があるときだけ）
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

const badge = (text, kind = "") => el("span", { class: `badge ${kind}`, text });

function show(page) {
  for (const p of PAGES) $(p).hidden = p !== page;
  const idx = PAGES.indexOf(page);
  for (const li of $("steps").children) {
    const i = PAGES.indexOf(li.dataset.step);
    li.className = i === idx ? "current" : i < idx ? "past" : "";
  }
}

// --- 環境チェック ---

async function runCheck() {
  $("to-select").disabled = true;
  $("recheck").disabled = true;
  $("check-title").textContent = "このパソコンを調べています";
  $("check-lead").textContent = "入っているものを確認しています…";
  $("check-list").replaceChildren(el("li", {}, el("div", { class: "row" }, el("span", { class: "spinner" }), el("span", { text: "確認中" }))));
  state.items = await window.setup.detectAll();
  renderCheck();
  $("recheck").disabled = false;
  $("to-select").disabled = false;
}

function renderCheck() {
  const missing = state.items.filter((i) => i.detection.state !== "installed" && i.supported).length;
  $("check-title").textContent = "このパソコンの状態";
  $("check-lead").textContent = missing ? `${missing} 個を入れる必要があります。` : "必要なものはすべて入っています。";
  $("check-list").replaceChildren(
    ...state.items.map((item) => {
      const d = item.detection;
      const [label, kind] = STATE_BADGE[d.state];
      return el(
        "li",
        {},
        el(
          "div",
          { class: "row" },
          el("div", { class: "grow" }, el("div", { class: "name", text: item.name }), el("div", { class: "desc", text: d.version ? `バージョン ${d.version}` : item.description })),
          badge(TIER_LABEL[item.tier]),
          badge(label, kind),
        ),
      );
    }),
  );
}

// --- 選択 ---

function defaultSelection() {
  state.selected = new Set(
    state.items.filter((i) => i.supported && i.detection.state !== "installed" && i.tier !== "optional").map((i) => i.id),
  );
}

function renderSelect() {
  $("select-list").replaceChildren(
    ...state.items.map((item) => {
      const d = item.detection;
      const installed = d.state === "installed";
      const locked = installed || !item.supported || item.tier === "required";
      const box = el("input", {
        type: "checkbox",
        checked: state.selected.has(item.id),
        disabled: locked,
      });
      box.addEventListener("change", () => {
        if (box.checked) state.selected.add(item.id);
        else state.selected.delete(item.id);
        renderSummary();
      });
      const note = installed ? `入っています${d.version ? `（${d.version}）` : ""}` : d.state === "installedNotOnPath" ? "入っていますが、ターミナルから使えるように設定します" : item.description;
      return el(
        "li",
        {},
        el(
          "label",
          {},
          box,
          el("div", { class: "grow" }, el("div", { class: "name", text: item.name }), el("div", { class: "desc", text: note })),
          item.admin ? badge("管理者パスワード", "warn") : null,
          badge(TIER_LABEL[item.tier]),
        ),
      );
    }),
  );
  renderSummary();
}

function renderSummary() {
  const chosen = state.items.filter((i) => state.selected.has(i.id));
  const mb = chosen.reduce((s, i) => s + (i.detection.state === "missing" ? i.approxSizeMB ?? 0 : 0), 0);
  $("select-summary").textContent = chosen.length ? `${chosen.length} 個を入れます（ダウンロード 約 ${mb} MB）` : "入れるものはありません。";
  $("do-install").textContent = chosen.length ? "インストール" : "次へ";
}

// --- インストール ---

function renderInstallRow(id) {
  const item = state.items.find((i) => i.id === id);
  const p = state.progress.get(id);
  const statusIcon = {
    waiting: el("span", { class: "status", text: "・" }),
    running: el("span", { class: "status" }, el("span", { class: "spinner" })),
    done: el("span", { class: "status", text: "✓" }),
    skipped: el("span", { class: "status", text: "✓" }),
    failed: el("span", { class: "status", text: "✕" }),
  }[p.status];
  const label = { waiting: ["待機中", ""], running: ["実行中", "run"], done: ["完了", "ok"], skipped: ["入っていました", "ok"], failed: ["失敗", "bad"] }[p.status];
  const showBar = p.status === "running" && p.total > 0 && p.received < p.total;
  const log = el("pre", { class: "log", text: p.lines.join("\n") });
  const details = el("details", { open: p.open }, el("summary", { text: `ログ（${p.lines.length} 行）` }), log);
  details.addEventListener("toggle", () => (p.open = details.open));
  const li = el(
    "li",
    { id: `row-${id}` },
    el("div", { class: "row" }, statusIcon, el("div", { class: "grow" }, el("div", { class: "name", text: item.name })), badge(...label)),
    showBar ? el("progress", { max: p.total, value: p.received }) : null,
    p.error ? el("div", { class: "error", text: p.error }) : null,
    p.lines.length ? details : null,
  );
  const old = $(`row-${id}`);
  if (old) old.replaceWith(li);
  else $("install-list").append(li);
  if (p.open) log.scrollTop = log.scrollHeight;
}

async function startInstall(ids) {
  state.lastIds = ids;
  for (const id of ids) state.progress.set(id, { status: "waiting", lines: [], open: false });
  $("install-list").replaceChildren();
  for (const id of ids) renderInstallRow(id);
  $("install-title").textContent = "インストールしています";
  $("install-lead").textContent = "ウィンドウを閉じずにお待ちください。";
  $("cancel").hidden = false;
  $("cancel").disabled = false;
  $("retry").hidden = true;
  $("to-done").hidden = true;
  show("install");
  state.installing = true;
  renderUpdate();
  const r = await window.setup.install(ids);
  if (r?.error) {
    $("install-lead").textContent = r.error;
    $("cancel").hidden = true;
    state.installing = false;
    renderUpdate();
  }
}

window.setup.onInstallEvent((e) => {
  if (e.type === "finished") return finishInstall(e);
  const p = state.progress.get(e.id);
  if (!p) return;
  if (e.type === "log") {
    p.lines.push(e.line);
  } else if (e.type === "progress") {
    p.received = e.received;
    p.total = e.total;
  } else if (e.type === "item") {
    p.status = e.status;
    p.error = e.error ?? null;
    if (e.status === "failed") p.open = true;
  }
  renderInstallRow(e.id);
});

function finishInstall(e) {
  state.installing = false;
  renderUpdate();
  const failed = [...state.progress].filter(([, p]) => p.status === "failed").map(([id]) => id);
  $("cancel").hidden = true;
  if (e.error || failed.length) {
    $("install-title").textContent = "うまくいかなかったものがあります";
    $("install-lead").textContent = e.error ?? "ログを確認して、やり直してください。直らないときは「サポート用にログをコピー」で送ってください。";
    $("retry").hidden = false;
    $("to-done").hidden = false;
    $("to-done").textContent = "このまま進む";
  } else {
    $("install-title").textContent = "インストールが終わりました";
    $("install-lead").textContent = state.info.dryRun ? "ドライランなので、実際には何も入れていません。" : "すべて入りました。";
    $("to-done").hidden = false;
    $("to-done").textContent = "次へ";
  }
  state.retryIds = failed;
}

// --- ログイン ---

const LOGIN_POLL_MS = 3000;
let loginTimer = null;

function renderLogin(rows) {
  $("login-list").replaceChildren(
    ...rows.map((r) => {
      const [label, kind] = !r.installed
        ? ["入っていません", ""]
        : r.loggedIn === true
          ? ["ログイン済み", "ok"]
          : r.loggedIn === false
            ? ["未ログイン", "warn"]
            : ["確認できません", ""];
      const btn = el("button", { class: r.loggedIn === true ? "" : "primary", text: r.loggedIn === true ? "もう一度" : "ログインする", disabled: !r.installed });
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const res = await window.setup.openLogin(r.id);
        btn.disabled = false;
        if (res?.error) alert(res.error);
      });
      return el(
        "li",
        {},
        el("div", { class: "row" }, el("div", { class: "grow" }, el("div", { class: "name", text: r.name }), r.detail ? el("div", { class: "desc", text: r.detail }) : null), badge(label, kind), btn),
      );
    }),
  );
}

async function pollLogin(refresh = false) {
  const rows = await window.setup.loginList(refresh);
  if ($("login").hidden) return;
  renderLogin(rows);
  loginTimer = setTimeout(() => pollLogin(), LOGIN_POLL_MS);
}

function stopLogin() {
  clearTimeout(loginTimer);
  loginTimer = null;
}

async function showLogin() {
  stopLogin();
  $("login-list").replaceChildren(el("li", {}, el("div", { class: "row" }, el("span", { class: "spinner" }), el("span", { text: "確認中" }))));
  show("login");
  pollLogin(true);
}

// --- 完了 ---

async function showDone() {
  state.items = await window.setup.detectAll();
  const paseo = state.items.find((i) => i.id === "paseo");
  $("launch-paseo").disabled = paseo?.detection.state === "missing";
  const notReady = state.items.filter((i) => i.tier === "required" && i.detection.state !== "installed");
  $("done-note").textContent = notReady.length
    ? `まだ使えないもの: ${notReady.map((i) => i.name).join("、")}`
    : "ターミナルは、このアプリを開く前から開いていたものではなく、新しく開いたものを使ってください。";
  show("done");
}

// --- AI Setup 自身の更新 ---

// phase: "available" | "downloading" | "restarting" | "failed"
function renderUpdate({ phase = "available", percent = null, error = null } = {}) {
  const u = state.update;
  const banner = $("update-banner");
  banner.hidden = !u;
  if (!u) return;
  banner.classList.toggle("bad", phase === "failed");
  const text = {
    available: u.blocker
      ? `新しいバージョン（v${u.latest}）があります。${u.blocker}`
      : `新しいバージョン（v${u.latest}）があります。${state.installing ? "インストールが終わってから更新できます。" : ""}`,
    downloading: `新しいバージョンを取得しています…${percent != null ? ` ${percent}%` : ""}`,
    restarting: "新しいバージョンに入れ替えて、開き直します…",
    failed: `更新できませんでした: ${error}`,
  }[phase];
  $("update-text").textContent = text;
  const idle = phase === "available" || phase === "failed";
  $("update-apply").hidden = !idle || !!u.blocker;
  $("update-apply").disabled = state.installing;
  $("update-apply").textContent = phase === "failed" ? "もう一度" : "更新する";
  $("update-page").hidden = !idle || !(u.blocker || phase === "failed");
}

// quiet: 起動時の確認。調べられなかったときも黙っておく
async function checkUpdate({ quiet = false } = {}) {
  const btn = $("check-update");
  btn.disabled = true;
  btn.textContent = "確認しています…";
  const r = await window.setup.checkUpdate();
  btn.disabled = false;
  state.update = r.available ? r : null;
  renderUpdate();
  const result = r.error ? "確認できませんでした" : r.available ? "新しいバージョンがあります" : "最新です";
  btn.textContent = quiet ? "更新を確認" : result;
  if (!quiet) setTimeout(() => (btn.textContent = "更新を確認"), 3000);
}

window.setup.onUpdateEvent((e) => {
  if (e.type === "progress") renderUpdate({ phase: "downloading", percent: e.total ? Math.floor((e.received / e.total) * 100) : null });
  else if (e.type === "restarting") renderUpdate({ phase: "restarting" });
});

// --- 起動 ---

(async () => {
  state.info = await window.setup.info();
  $("dry-banner").hidden = !state.info.dryRun;
  $("env").textContent = `${state.info.os === "darwin" ? "macOS" : "Windows"} ${state.info.arch} ・ v${state.info.version}`;
  if (state.info.catalogErrors.length) console.error(state.info.catalogErrors);
  show("welcome");
  checkUpdate({ quiet: true });
})();

$("start").addEventListener("click", () => {
  show("check");
  runCheck();
});
$("recheck").addEventListener("click", runCheck);
$("to-select").addEventListener("click", () => {
  defaultSelection();
  renderSelect();
  show("select");
});
$("back-check").addEventListener("click", () => show("check"));
$("do-install").addEventListener("click", () => {
  const ids = state.items.filter((i) => state.selected.has(i.id)).map((i) => i.id);
  if (ids.length) startInstall(ids);
  else showLogin();
});
$("cancel").addEventListener("click", () => {
  $("cancel").disabled = true;
  $("install-lead").textContent = "中断しています…（管理者権限で動いているものは止められません）";
  window.setup.cancel();
});
$("retry").addEventListener("click", () => startInstall(state.retryIds));
$("to-done").addEventListener("click", showLogin);
$("login-next").addEventListener("click", () => (stopLogin(), showDone()));
$("login-skip").addEventListener("click", () => (stopLogin(), showDone()));
$("launch-paseo").addEventListener("click", () => window.setup.launch("paseo"));
$("check-update").addEventListener("click", () => checkUpdate());
$("update-apply").addEventListener("click", async () => {
  renderUpdate({ phase: "downloading" });
  const r = await window.setup.applyUpdate();
  if (r?.error) renderUpdate({ phase: "failed", error: r.error });
});
$("update-page").addEventListener("click", () => window.setup.openUpdatePage());
$("copy-log").addEventListener("click", async () => {
  await window.setup.copyLog();
  const btn = $("copy-log");
  btn.textContent = "コピーしました";
  setTimeout(() => (btn.textContent = "サポート用にログをコピー"), 2000);
});
