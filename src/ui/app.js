// 画面の進行: ようこそ → 環境チェック → 選択 → インストール → ログイン → 完了
const $ = (id) => document.getElementById(id);
const PAGES = ["welcome", "check", "select", "install", "login", "done"];
const TIER_LABEL = { recommended: "おすすめ", optional: "任意" };
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
  returning: false, // 2回目以降の起動（ログインの要るものがもう入っている）。ログインの確認から始める
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

// --- グループ ---
// 項目は種類ごとのグループに分けて見せる。atLeastOne のグループ（AI エージェント）は、どれか1つあればよい

const present = (i) => i.detection.state === "installed" || i.detection.state === "installedNotOnPath";
const members = (g) => state.items.filter((i) => i.group === g.id);
// 「Claude Code か Codex CLI のどちらか」。3つ以上なら名前を並べず「AI エージェントのどれか1つ」
const pickOne = (g) => {
  const names = members(g).filter((i) => i.supported).map((i) => i.name);
  return names.length === 2 ? `${names.join(" か ")} のどちらか` : `${g.name}のどれか1つ`;
};

// atLeastOne のグループのうち、条件（ok: 項目 → 足りているか）を満たす項目が1つも無いもの
const unmetGroups = (ok) => state.info.groups.filter((g) => g.atLeastOne && !members(g).some(ok));

// 選ぶ画面では、グループの下に注意の欄（group-note-<id>）を置く。中身は renderSummary が選択のたびに書き換える
function renderGroups(container, renderItem, { selectable = false } = {}) {
  container.replaceChildren(
    ...state.info.groups
      .filter((g) => members(g).length)
      .map((g) =>
        el(
          "section",
          { class: "group" },
          el("div", { class: "group-head" }, el("h2", { text: g.name }), el("div", { class: "desc", text: g.description })),
          el("ul", { class: selectable ? "items selectable" : "items" }, ...members(g).map(renderItem)),
          selectable ? el("div", { class: "error", id: `group-note-${g.id}`, hidden: true }) : null,
        ),
      ),
  );
}

function show(page) {
  $("boot").hidden = true;
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
  $("check-list").replaceChildren(el("ul", { class: "items" }, el("li", {}, el("div", { class: "row" }, el("span", { class: "spinner" }), el("span", { text: "確認中" })))));
  state.items = await window.setup.detectAll();
  renderCheck();
  $("recheck").disabled = false;
  $("to-select").disabled = false;
}

function renderCheck() {
  const missing = state.items.filter((i) => i.detection.state !== "installed" && i.supported).length;
  $("check-title").textContent = "このパソコンの状態";
  $("check-lead").textContent = missing ? `${missing} 個がまだ入っていません。次の画面で、入れるものを選べます。` : "すべて入っています。";
  renderGroups($("check-list"), (item) => {
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
  });
}

// --- 選択 ---

// 選んだものが頼る項目（Pi → Node.js、Hermes → Git）も、入っていなければ一緒に選ぶ。
// 入れるときにも足されるが、画面に出しておかないと黙って入ることになる
function withDeps(ids) {
  const out = new Set(ids);
  const visit = (id) => {
    for (const dep of state.items.find((i) => i.id === id)?.dependsOn ?? []) {
      const d = state.items.find((i) => i.id === dep);
      if (!d || out.has(dep) || d.detection.state === "installed") continue;
      out.add(dep);
      visit(dep);
    }
  };
  for (const id of ids) visit(id);
  return out;
}

// おすすめを選んでおく。ただし、どれか1つでよいグループにもう入っているものがあれば、ほかは足さない
function defaultSelection() {
  const satisfied = new Set(state.info.groups.filter((g) => g.atLeastOne && members(g).some(present)).map((g) => g.id));
  state.selected = withDeps(
    state.items
      .filter((i) => i.supported && i.detection.state !== "installed" && i.tier === "recommended")
      .filter((i) => !satisfied.has(i.group) || present(i))
      .map((i) => i.id),
  );
}

function renderSelect() {
  renderGroups(
    $("select-list"),
    (item) => {
      const d = item.detection;
      const installed = d.state === "installed";
      const locked = installed || !item.supported;
      const box = el("input", {
        type: "checkbox",
        checked: state.selected.has(item.id),
        disabled: locked,
      });
      box.addEventListener("change", () => {
        if (box.checked) {
          const before = state.selected.size;
          state.selected = withDeps([...state.selected, item.id]);
          if (state.selected.size > before + 1) return renderSelect(); // 頼る項目にも印を付けて見せる
        } else state.selected.delete(item.id);
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
    },
    { selectable: true },
  );
  renderSummary();
}

function renderSummary() {
  const chosen = state.items.filter((i) => state.selected.has(i.id));
  const mb = chosen.reduce((s, i) => s + (i.detection.state === "missing" ? i.approxSizeMB ?? 0 : 0), 0);
  $("select-summary").textContent = chosen.length ? `${chosen.length} 個を入れます（ダウンロード 約 ${mb} MB）` : "入れるものはありません。";
  $("do-install").textContent = chosen.length ? "インストール" : "次へ";
  const unmet = new Set(unmetGroups((i) => present(i) || state.selected.has(i.id)).map((g) => g.id));
  for (const g of state.info.groups) {
    const note = $(`group-note-${g.id}`);
    if (!note) continue;
    note.hidden = !unmet.has(g.id);
    note.textContent = `${pickOne(g)}を選んでください。`;
  }
  $("do-install").disabled = unmet.size > 0;
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
    p.status === "running" && p.attention ? el("div", { class: "attention", text: p.attention }) : null,
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
  state.progress.clear(); // 前回の項目（受け付けられなかった依頼の分も）を残さない
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
  } else if (e.type === "attention") {
    p.attention = e.message;
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
  // ログインの確認から始めたときは、入っているものだけを出す（入れるのは「ほかのものを入れる」から）
  const shown = state.returning ? rows.filter((r) => r.installed) : rows;
  $("login-list").replaceChildren(
    ...shown.map((r) => {
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

// refresh: false なら、起動時の判定（app:returning）の結果をそのまま使う
async function showLogin({ refresh = true } = {}) {
  stopLogin();
  $("login-list").replaceChildren(el("li", {}, el("div", { class: "row" }, el("span", { class: "spinner" }), el("span", { text: "確認中" }))));
  $("login-title").textContent = state.returning ? "ログインの確認" : "ログインしましょう";
  $("login-more").hidden = !state.returning;
  $("login-skip").hidden = state.returning;
  show("login");
  pollLogin(refresh);
}

// --- 完了 ---

// 使い方の案内は groups.json の done で決める
// （"launch": アプリを開くボタン / "terminal": 打つコマンド / "start": 使い始める前に一度開くアプリ）
async function showDone() {
  state.items = await window.setup.detectAll();
  const groupOf = (i) => state.info.groups.find((g) => g.id === i.group);
  const openable = (kind) => state.items.filter((i) => groupOf(i)?.done === kind && i.launchable && present(i));
  const apps = openable("launch");
  const starts = openable("start");
  const commands = state.items.filter((i) => groupOf(i)?.done === "terminal" && i.command && i.detection.state === "installed");
  const buttons = (list) =>
    list.map((i) => {
      const btn = el("button", { class: "primary", text: `${i.name} を開く` });
      btn.addEventListener("click", () => window.setup.launch(i.id));
      return btn;
    });
  $("launch-list").replaceChildren(...buttons(apps));
  $("start-list").replaceChildren(...buttons(starts));
  $("command-list").replaceChildren(...commands.map((i) => el("pre", {}, el("code", { text: i.command }))));
  $("done-apps").hidden = !apps.length;
  $("done-start").hidden = !starts.length;
  $("done-terminal").hidden = !commands.length;
  $("done-lead").textContent = apps.length && commands.length ? "使い始めるには、どちらかの方法で。" : apps.length || commands.length ? "使い始めるには、次の方法で。" : "";
  const notReady = unmetGroups((i) => i.detection.state === "installed");
  $("done-note").textContent = notReady.length
    ? `まだ使えません: ${notReady.map(pickOne).join("、")}を入れてください。`
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
  checkUpdate({ quiet: true });
  // ログインが切れて開き直すことが多いので、もう入っているならログインの確認から始める
  state.returning = await window.setup.isReturning();
  if (state.returning) showLogin({ refresh: false });
  else show("welcome");
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
  const chosen = withDeps([...state.selected]); // 頼る項目の印を外していても、入れるときには要る
  const ids = state.items.filter((i) => chosen.has(i.id)).map((i) => i.id);
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
$("login-more").addEventListener("click", () => {
  stopLogin();
  state.returning = false; // ここからは初めてのときと同じ流れ（環境チェック → 選択 → インストール → ログイン）
  show("check");
  runCheck();
});
$("login-skip").addEventListener("click", () => (stopLogin(), showDone()));
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
