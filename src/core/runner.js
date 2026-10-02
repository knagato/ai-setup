// Step[] を順に実行する。出力は1行ずつ onLog に流し、signal で中断できる。
// dryRun のときは何も実行・書き込みせず、手順の説明だけを流す。

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { describeStep } = require("./plan");
const { download } = require("./download");
const { ensurePathDarwin } = require("./pathfix");
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

function spawnStep(step, { ctx, envInfo, onLog, signal, timeoutMs = 20 * 60 * 1000 }) {
  if (step.elevate) throw new Error("管理者権限での実行はまだ対応していません（M2/M4）");
  return new Promise((resolve, reject) => {
    const isWin = ctx.os === "win32";
    const child = spawn(step.cmd, step.args, {
      env: childEnv(ctx, envInfo, step.env),
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

async function installMacApp({ src, name }, ctx, onLog) {
  // 別のホームを装っているときは、本物の /Applications を汚さない
  const system = "/Applications";
  const dir = !ctx.homeOverridden && writable(system) ? system : expand(ctx, "~/Applications");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, name);
  if (fs.existsSync(dest)) throw new Error(`${dest} が既にあります。上書きはしません`);
  await mustRun("/usr/bin/ditto", [src, dest]);
  onLog(`${dest} に置きました`);
  return dest;
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

async function ensurePath({ dir }, ctx, onLog) {
  if (ctx.os === "win32") throw new Error("Windows の PATH 設定はまだ対応していません（M4）");
  const login = await loginShellPath(ctx);
  if (login?.includes(dir)) return onLog(`${dir} は PATH に入っています`);
  const r = ensurePathDarwin(ctx, dir);
  if (!r.changed) return onLog(`${dir} は ${r.file} に設定済みです`);
  onLog(`${r.file} に ${dir} を追加しました${r.backup ? `（元のファイルは ${r.backup}）` : ""}`);
}

// opts: { ctx, envInfo, dryRun, onLog(line), onProgress({received,total}), signal, vars }
async function runSteps(steps, opts) {
  const { ctx, envInfo, dryRun = false, onLog = () => {}, onProgress, signal } = opts;
  const vars = { ...opts.vars };
  if (!dryRun && steps.some((s) => JSON.stringify(s).includes("{tmp}"))) {
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
          await spawnStep(step, { ctx, envInfo, onLog, signal });
          break;
        case "unzip":
          if (ctx.os === "win32") throw new Error("Windows の展開はまだ対応していません（M4）");
          await mustRun("/usr/bin/ditto", ["-x", "-k", step.archive, step.dest]);
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
        default:
          throw new Error(`未知の手順です: ${step.kind}`);
      }
    }
  } finally {
    if (vars.tmp) fs.rmSync(vars.tmp, { recursive: true, force: true });
  }
  return vars;
}

module.exports = { runSteps, fill };
