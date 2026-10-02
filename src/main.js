// AI Setup: Claude Code・Codex・Paseo などを、ターミナルを使わずに入れるインストーラ。
// 中身（判定・手順・実行）は src/core にあり、ここは画面との橋渡しだけをする。
// 画面からは「カタログにある id を入れて」としか頼めない（任意のコマンドは受け付けない）。
//
//   pnpm start            … 普通に起動
//   pnpm run start:dry    … 何も入れず、実行する手順だけを流す

const { app, BrowserWindow, ipcMain, clipboard, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { loadCatalog, validateCatalog } = require("./core/catalog");
const { makeContext } = require("./core/platform");
const { probeEnv } = require("./core/env");
const { detectAll } = require("./core/detect");
const { installItems } = require("./core/installer");
const selfUpdate = require("./core/selfupdate");

const dryRun = process.argv.includes("--dry-run");
const items = loadCatalog();
const ctx = makeContext();

let win;
let running = null; // 実行中のインストールの AbortController
let updating = null; // 実行中の更新の AbortController
let latestUpdate = null; // update:check で見つけた新しい版
const logLines = []; // 「ログをコピー」用（画面に出したものと同じ）

// トークンらしきものは伏せてから残す
const SECRET = /\b(sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,})|(Bearer\s+)\S+/g;
const redact = (s) => s.replace(SECRET, (m, tok, bearer) => (bearer ? `${bearer}***` : "***"));

function writeLog(line) {
  const text = redact(line);
  logLines.push(text);
  if (logLines.length > 5000) logLines.shift();
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "ai-setup.log"), `${new Date().toISOString()} ${text}\n`);
  } catch {}
}

const fromWindow = (e) => e.sender === win?.webContents;
const handle = (channel, fn) => ipcMain.handle(channel, (e, ...args) => (fromWindow(e) ? fn(...args) : { error: "forbidden" }));
const send = (channel, payload) => win?.webContents.send(channel, payload);

function itemSummary(item) {
  const p = item.platforms[ctx.os];
  return {
    id: item.id,
    name: item.name,
    tier: item.tier,
    description: item.description,
    approxSizeMB: item.approxSizeMB ?? null,
    admin: !!(p?.install.elevate || p?.install.admin),
    supported: !!p,
  };
}

async function detectEverything() {
  const envInfo = await probeEnv(ctx);
  const detections = await detectAll(items, ctx, envInfo);
  return items.map((item, i) => ({ ...itemSummary(item), detection: detections[i] }));
}

handle("app:info", () => ({
  os: ctx.os,
  arch: ctx.arch,
  home: ctx.home,
  dryRun,
  version: app.getVersion(),
  catalogErrors: validateCatalog(items),
}));

handle("detect:all", () => detectEverything());

handle("install:start", (ids) => {
  if (running) return { error: "インストールの途中です" };
  if (updating) return { error: "AI Setup を更新しています" };
  const known = new Set(items.map((i) => i.id));
  if (!Array.isArray(ids) || !ids.length || !ids.every((id) => known.has(id))) return { error: "選択が正しくありません" };

  running = new AbortController();
  writeLog(`== インストール開始 ${ids.join(", ")}${dryRun ? "（ドライラン）" : ""}`);
  installItems(ids, {
    items,
    ctx,
    dryRun,
    signal: running.signal,
    onEvent: (e) => {
      if (e.type === "log") writeLog(`[${e.id}] ${e.line}`);
      if (e.type === "item" && e.status !== "running") writeLog(`[${e.id}] => ${e.status}${e.error ? `: ${e.error}` : ""}`);
      send("install:event", e.type === "log" ? { ...e, line: redact(e.line) } : e);
    },
  })
    .then((results) => send("install:event", { type: "finished", results }))
    .catch((e) => {
      writeLog(`== 失敗 ${e.message}`);
      send("install:event", { type: "finished", error: e.message });
    })
    .finally(() => {
      running = null;
    });
  return { started: true };
});

handle("install:cancel", () => {
  running?.abort();
  return { ok: true };
});

handle("log:copy", () => {
  const header = [
    `AI Setup ${app.getVersion()}${dryRun ? "（ドライラン）" : ""}`,
    `${ctx.os} ${ctx.arch} / Electron ${process.versions.electron}`,
    `ログ: ${path.join(app.getPath("userData"), "ai-setup.log")}`,
    "",
  ];
  clipboard.writeText([...header, ...logLines].join("\n"));
  return { ok: true };
});

handle("app:launch", async (id) => {
  const item = items.find((i) => i.id === id);
  if (!item?.launch) return { error: "起動できません" };
  const detection = (await detectEverything()).find((d) => d.id === id)?.detection;
  const target = detection?.appPath ?? detection?.path;
  if (!target) return { error: "見つかりません" };
  const err = await shell.openPath(target);
  return err ? { error: err } : { ok: true };
});

// --- このアプリ自身の更新 ---

const appPath = ctx.os === "darwin" ? selfUpdate.appBundlePath(process.execPath) : null;

// 更新を入れられない理由（入れられるなら null）。画面ではダウンロードページを案内する
function updateBlocker() {
  if (!app.isPackaged) return "開発中の起動では入れ替えません";
  if (dryRun) return "ドライラン中は入れ替えません";
  if (ctx.os === "darwin") return selfUpdate.whyCannotReplace(appPath);
  return null;
}

handle("update:check", async () => {
  try {
    const r = await selfUpdate.checkForUpdate(app.getVersion(), ctx);
    latestUpdate = r.available ? r : null;
    if (r.available) writeLog(`== 新しい版があります ${r.current} → ${r.latest}`);
    return { available: r.available, current: r.current, latest: r.latest, blocker: r.available ? updateBlocker() : null };
  } catch (e) {
    writeLog(`== 新しい版を調べられませんでした: ${e.message}`);
    return { error: e.message };
  }
});

handle("update:apply", async () => {
  if (running) return { error: "インストールが終わってから更新してください" };
  if (updating) return { error: "更新の途中です" };
  if (!latestUpdate) return { error: "新しい版はありません" };
  const blocker = updateBlocker();
  if (blocker) return { error: blocker };

  updating = new AbortController();
  writeLog(`== 更新開始 ${latestUpdate.current} → ${latestUpdate.latest}`);
  try {
    const prepared = await selfUpdate.prepareUpdate(latestUpdate, {
      ctx,
      appPath,
      signal: updating.signal,
      onLog: (line) => writeLog(`[update] ${line}`),
      onProgress: (p) => send("update:event", { type: "progress", ...p }),
    });
    writeLog("== 更新の準備ができました。開き直します");
    send("update:event", { type: "restarting" });
    selfUpdate.launchUpdate(prepared, { pid: process.pid, appPath, log: path.join(app.getPath("userData"), "update.log") });
    setTimeout(() => app.quit(), 500);
    return { ok: true };
  } catch (e) {
    writeLog(`== 更新に失敗しました: ${e.message}`);
    return { error: e.message };
  } finally {
    updating = null;
  }
});

handle("update:openPage", () => shell.openExternal(selfUpdate.RELEASES_PAGE));

function createWindow() {
  win = new BrowserWindow({
    width: 880,
    height: 680,
    minWidth: 720,
    minHeight: 560,
    title: "AI Setup",
    backgroundColor: "#f6f5f2",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, "ui", "index.html"));
  // 画面内のリンクはブラウザで開く（アプリ内に別のページを開かない）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });
  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => {
    running?.abort();
    updating?.abort();
    app.quit();
  });
}
