// 画面の進行: ようこそ → 環境チェック → 選択 → インストール → 完了
const $ = (id) => document.getElementById(id);
const PAGES = ["welcome", "check", "select", "install", "done"];
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
  const r = await window.setup.install(ids);
  if (r?.error) {
    $("install-lead").textContent = r.error;
    $("cancel").hidden = true;
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

// --- 起動 ---

(async () => {
  state.info = await window.setup.info();
  $("dry-banner").hidden = !state.info.dryRun;
  $("env").textContent = `${state.info.os === "darwin" ? "macOS" : "Windows"} ${state.info.arch} ・ v${state.info.version}`;
  if (state.info.catalogErrors.length) console.error(state.info.catalogErrors);
  show("welcome");
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
  else showDone();
});
$("cancel").addEventListener("click", () => {
  $("cancel").disabled = true;
  $("install-lead").textContent = "中断しています…（管理者権限で動いているものは止められません）";
  window.setup.cancel();
});
$("retry").addEventListener("click", () => startInstall(state.retryIds));
$("to-done").addEventListener("click", showDone);
$("launch-paseo").addEventListener("click", () => window.setup.launch("paseo"));
$("copy-log").addEventListener("click", async () => {
  await window.setup.copyLog();
  const btn = $("copy-log");
  btn.textContent = "コピーしました";
  setTimeout(() => (btn.textContent = "サポート用にログをコピー"), 2000);
});
