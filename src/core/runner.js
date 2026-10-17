// Step[] を順に実行する。出力は1行ずつ onLog に流し、signal で中断できる。
// dryRun のときは何も実行・書き込みせず、手順の説明だけを流す。

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { describeStep } = require("./plan");
const { download } = require("./download");
const { ensurePathDarwin, ensureShellenvDarwin, backup } = require("./pathfix");
const { loginShellPath, childEnv, run } = require("./env");
const { expand } = require("./platform");

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\r/g;

// 文字列中の {tmp} / {appPath} を埋める
function fill(value, vars) {
  if (typeof value === "string") return value.replace(/\{(tmp|appPath)\}/g, (m, k) => vars[k] ?? m);
  if (Array.isArray(value)) return value.map((v) => fill(v, vars));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)]));
  return value;
}

function lineSplitter(onLine) {
  let rest = "";
  return {
    push(chunk) {
      const parts = (rest + chunk.toString("utf8")).split("\n");
      rest = parts.pop();
      for (const p of parts) {
        const line = p.replace(ANSI, "").trimEnd();
        if (line) onLine(line);
      }
    },
    flush() {
      const line = rest.replace(ANSI, "").trimEnd();
      if (line) onLine(line);
      rest = "";
    },
  };
}

// sudo -A が呼ぶ、パスワードを聞くスクリプト。OS の入力画面（osascript）で聞いて標準出力に返す。
// パスワードはどこにも保存しない（sudo が受け取るだけ）。キャンセルすると osascript が失敗し、sudo も失敗する
function writeAskpass(dir, message) {
  const file = path.join(dir, "askpass.sh");
  const quote = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const dialog =
    `text returned of (display dialog "${quote(message)}" default answer "" with hidden answer ` +
    `with title "AI Setup" with icon caution buttons {"キャンセル", "OK"} default button "OK" cancel button "キャンセル")`;
  fs.writeFileSync(file, `#!/bin/sh\nexec /usr/bin/osascript -e '${dialog.replace(/'/g, "'\\''")}'\n`, { mode: 0o700 });
  return file;
}

function spawnStep(step, { ctx, envInfo, onLog, onAttention = () => {}, signal, timeoutMs = step.timeoutMs ?? 20 * 60 * 1000, tmp }) {
  if (step.elevate) throw new Error("管理者権限での実行はまだ対応していません（M2/M4）");
  if (step.askpass && ctx.os === "win32") throw new Error("Windows では askpass を使えません");
  if (step.askpass && ctx.homeOverridden) throw new Error("仮のホームでは、管理者パスワードの要るものは入れません（システム全体に入るため）");
  const extra = { ...step.env };
  if (step.askpass) {
    extra.SUDO_ASKPASS = writeAskpass(tmp, step.askpass);
    const ask = "パスワードを聞く画面が出たら、この Mac にログインするときのパスワードを入れてください";
    onLog(ask);
    onAttention(ask);
  }
  return new Promise((resolve, reject) => {
    const isWin = ctx.os === "win32";
    const child = spawn(step.cmd, step.args, {
      env: childEnv(ctx, envInfo, extra),
      stdio: ["ignore", "pipe", "pipe"],
      detached: !isWin, // 中断時にプロセスグループごと止める
      windowsHide: true,
    });
    const tail = [];
    const onLine = (line) => {
      tail.push(line);
      if (tail.length > 20) tail.shift();
      onLog(line);
    };
    // 標準出力と標準エラーで行の途中が混ざらないよう、別々に区切る
    const stdoutLines = lineSplitter(onLine);
    const stderrLines = lineSplitter(onLine);
    child.stdout.on("data", (c) => stdoutLines.push(c));
    child.stderr.on("data", (c) => stderrLines.push(c));

    const kill = () => {
      if (child.exitCode != null) return;
      if (isWin) spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {}
      }
    };
    const timer = setTimeout(() => {
      onLog(`時間切れ（${Math.round(timeoutMs / 60000)} 分）のため止めます`);
      kill();
    }, timeoutMs);
    const onAbort = () => kill();
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (e) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(e);
    });
    child.on("close", (code, sig) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      stdoutLines.flush();
      stderrLines.flush();
      if (signal?.aborted) return reject(new Error("中断しました"));
      if (code === 0) return resolve();
      const err = new Error(`${path.basename(step.cmd)} が失敗しました（${sig ?? `終了コード ${code}`}）`);
      err.tail = tail;
      reject(err);
    });
  });
}

async function mustRun(cmd, args) {
  const { error, stdout } = await run(cmd, args, { timeout: 120000 });
  if (error) throw new Error(`${path.basename(cmd)} ${args.join(" ")}: ${(error.stderr || error.message).trim()}`);
  return stdout;
}

async function verifyMacApp({ app, teamId }, onLog) {
  await mustRun("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  if (teamId) {
    // codesign -dv は結果を標準エラーに出す
    const info = await new Promise((resolve) =>
      execFile("/usr/bin/codesign", ["-dv", app], (e, so, se) => resolve(`${so}${se}`)),
    );
    const actual = info.match(/TeamIdentifier=(\S+)/)?.[1];
    if (actual !== teamId) throw new Error(`署名したチームが違います（期待 ${teamId}、実際 ${actual ?? "なし"}）`);
  }
  await mustRun("/usr/sbin/spctl", ["--assess", "--type", "execute", app]);
  onLog("署名と公証を確認しました");
}

function writable(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function installMacApp({ src, name, systemOnly = false }, ctx, onLog) {
  // 別のホームを装っているときは、本物の /Applications を汚さない
  const system = "/Applications";
  if (systemOnly && !ctx.homeOverridden && !writable(system)) {
    throw new Error(`${name} は「アプリケーション」フォルダにしか置けませんが、このアカウントでは書き込めません。管理者のアカウントで入れてください`);
  }
  const dir = !ctx.homeOverridden && writable(system) ? system : expand(ctx, "~/Applications");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, name);
  if (fs.existsSync(dest)) throw new Error(`${dest} が既にあります。上書きはしません`);
  await mustRun("/usr/bin/ditto", [src, dest]);
  onLog(`${dest} に置きました`);
  return dest;
}

// 展開したフォルダを dest に置く。同じ版が既にあれば置き換える（途中で失敗したものが残っていても直る）
async function installDir({ src, dest }, onLog) {
  if (!fs.existsSync(src)) throw new Error(`展開したものの中に ${path.basename(src)} がありません`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  try {
    fs.renameSync(src, dest);
  } catch {
    await mustRun("/usr/bin/ditto", [src, dest]); // 一時フォルダが別のボリュームにあるとき
  }
  onLog(`${dest} に置きました`);
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new Error("中断しました"))), { once: true });
  });

// ダイアログ（と、押したあとの進み具合の窓）を出しているアプリ。キャンセルすると終わる
const CLT_DIALOG_APP = "Install Command Line Developer Tools.app";

const cltProbe = {
  installed: async () => !(await run("/usr/bin/xcode-select", ["-p"])).error,
  dialogOpen: async () => !(await run("/usr/bin/pgrep", ["-f", CLT_DIALOG_APP])).error,
  request: () => run("/usr/bin/xcode-select", ["--install"]), // 既に頼んであるときは失敗するが、そのまま待てばよい
};

// OS のダイアログを出して、入り終わるまで待つ（ダウンロードを含めて数分〜数十分かかる）。
// 人がボタンを押すまで進まないので、出したときと、待ちが続くあいだ remindMs ごとに onAttention で知らせる。
// ダイアログが閉じられた（キャンセルされた）ら、時間切れを待たずに失敗にする
async function xcodeClt(
  ctx,
  { onLog, onAttention = () => {}, signal },
  { pollMs = 5000, timeoutMs = 60 * 60 * 1000, remindMs = 10 * 60 * 1000, probe = cltProbe } = {},
) {
  if (await probe.installed()) return onLog("Xcode のコマンドライン・ツールは入っています");
  if (ctx.homeOverridden) throw new Error("仮のホームでは Xcode のコマンドライン・ツールは入れません（システム全体に入るため）");
  await probe.request();
  const ask = "画面に出た「コマンドライン・デベロッパ・ツール」のダイアログで「インストール」を押してください";
  onLog(ask);
  onAttention(ask);
  const start = Date.now();
  let nextRemind = start + remindMs;
  let seen = false; // ダイアログが出たのを一度でも見たか（見ないうちは、閉じたとは判断しない）
  let gone = 0; // ダイアログが続けて見えなかった回数
  let n = 0;
  while (Date.now() - start < timeoutMs) {
    await sleep(pollMs, signal);
    if (await probe.installed()) return onLog("Xcode のコマンドライン・ツールが入りました");
    if (await probe.dialogOpen()) {
      seen = true;
      gone = 0;
    } else if (seen && ++gone >= 3) {
      // 入り終わってダイアログが閉じた直後かもしれないので、もう一度だけ確かめる
      if (await probe.installed()) return onLog("Xcode のコマンドライン・ツールが入りました");
      throw new Error("ダイアログが閉じられたため、入りませんでした。もう一度やり直してください");
    }
    if (Date.now() >= nextRemind) {
      onAttention("Xcode のコマンドライン・ツールが入り終わるのを待っています。ダイアログの「インストール」をまだ押していなければ、押してください");
      nextRemind += remindMs;
    }
    if (++n % 12 === 0) onLog("入り終わるのを待っています…");
  }
  throw new Error(
    (await probe.dialogOpen())
      ? "時間内に入り終わりませんでした。画面に残っているダイアログで「インストール」を押してから、やり直してください"
      : "時間内に入り終わりませんでした。もう一度やり直してください",
  );
}

function symlink({ target, link }, onLog) {
  if (!fs.existsSync(target)) throw new Error(`リンク先がありません: ${target}`);
  fs.mkdirSync(path.dirname(link), { recursive: true });
  let current = null;
  try {
    current = fs.lstatSync(link);
  } catch {}
  if (current && !current.isSymbolicLink()) {
    onLog(`${link} は普通のファイルなので、そのままにします`);
    return;
  }
  if (current) {
    if (fs.readlinkSync(link) === target) return onLog(`${link} は設定済みです`);
    fs.unlinkSync(link);
  }
  fs.symlinkSync(target, link);
  onLog(`${link} → ${target}`);
}

// Homebrew の bin を PATH に足す。新しいターミナルで既に見えている（自分で設定済み）なら書かない
async function shellenv({ brew }, ctx, onLog) {
  const dir = path.dirname(brew);
  const login = await loginShellPath(ctx);
  if (login?.includes(dir)) return onLog(`${dir} は PATH に入っています`);
  const r = ensureShellenvDarwin(ctx, brew);
  if (!r.changed) return onLog(`${brew} shellenv は ${r.file} に設定済みです`);
  onLog(`${r.file} に Homebrew の設定を追加しました${r.backup ? `（元のファイルは ${r.backup}）` : ""}`);
}

async function ensurePath({ dir }, ctx, onLog) {
  if (ctx.os === "win32") throw new Error("Windows の PATH 設定はまだ対応していません（M4）");
  const login = await loginShellPath(ctx);
  if (login?.includes(dir)) return onLog(`${dir} は PATH に入っています`);
  const r = ensurePathDarwin(ctx, dir);
  if (!r.changed) return onLog(`${dir} は ${r.file} に設定済みです`);
  onLog(`${r.file} に ${dir} を追加しました${r.backup ? `（元のファイルは ${r.backup}）` : ""}`);
}

// opts: { ctx, envInfo, dryRun, onLog(line), onProgress({received,total}), onAttention(message), signal, vars }
//   onAttention … 人の操作を待っているとき（OS のダイアログなど）に呼ぶ
async function runSteps(steps, opts) {
  const { ctx, envInfo, dryRun = false, onLog = () => {}, onProgress, onAttention, signal } = opts;
  const vars = { ...opts.vars };
  if (!dryRun && steps.some((s) => s.askpass || JSON.stringify(s).includes("{tmp}"))) {
    vars.tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-setup-"));
  }
  try {
    for (const raw of steps) {
      if (signal?.aborted) throw new Error("中断しました");
      const step = fill(raw, vars);
      onLog(`▶ ${describeStep(step)}`);
      if (dryRun) continue;
      switch (step.kind) {
        case "download": {
          const { bytes } = await download(step.url, step.dest, { hash: step.hash, addBom: step.addBom, signal, onProgress });
          onLog(`${(bytes / 1024 / 1024).toFixed(1)} MB を取得しました`);
          break;
        }
        case "spawn":
          await spawnStep(step, { ctx, envInfo, onLog, onAttention, signal, tmp: vars.tmp });
          break;
        case "unzip":
          if (ctx.os === "win32") throw new Error("Windows の展開はまだ対応していません（M4）");
          await mustRun("/usr/bin/ditto", ["-x", "-k", step.archive, step.dest]);
          break;
        case "untar":
          if (ctx.os === "win32") throw new Error("Windows の展開はまだ対応していません（M4）");
          fs.mkdirSync(step.dest, { recursive: true });
          await mustRun("/usr/bin/tar", ["-xzf", step.archive, "-C", step.dest]);
          break;
        case "installDir":
          await installDir(step, onLog);
          break;
        case "xcodeClt":
          await xcodeClt(ctx, { onLog, onAttention, signal });
          break;
        case "verifyMacApp":
          await verifyMacApp(step, onLog);
          break;
        case "installMacApp":
          vars.appPath = await installMacApp(step, ctx, onLog);
          break;
        case "symlink":
          symlink(step, onLog);
          break;
        case "ensurePath":
          await ensurePath(step, ctx, onLog);
          break;
        case "shellenv":
          if (ctx.os === "win32") throw new Error("Windows では使えません");
          await shellenv(step, ctx, onLog);
          break;
        case "mountDmg":
          fs.mkdirSync(step.mountpoint, { recursive: true });
          await mustRun("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", step.mountpoint, step.dmg]);
          (vars.mounts ??= []).push(step.mountpoint);
          break;
        case "unmountDmg":
          await mustRun("/usr/bin/hdiutil", ["detach", step.mountpoint]);
          vars.mounts = (vars.mounts ?? []).filter((m) => m !== step.mountpoint);
          break;
        case "backup":
          for (const file of step.files) {
            const saved = backup(file);
            if (saved) onLog(`${file} を ${saved} に退避しました`);
          }
          break;
        default:
          throw new Error(`未知の手順です: ${step.kind}`);
      }
    }
  } finally {
    // 途中で失敗・中断したときも、マウントしたままにしない（外してから一時フォルダを消す）
    for (const m of vars.mounts ?? []) await run("/usr/bin/hdiutil", ["detach", "-force", m], { timeout: 60000 });
    delete vars.mounts;
    if (vars.tmp) fs.rmSync(vars.tmp, { recursive: true, force: true });
  }
  return vars;
}

module.exports = { runSteps, fill, xcodeClt };
