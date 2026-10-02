// 入っているかどうかの判定。状態は4つ:
//   installed           入っていて、新しいターミナルからも使える
//   installedNotOnPath  入っているが PATH が通っていない（後処理だけやり直せば直る）
//   missing             入っていない
//   unsupported         この OS では入れられない

const fs = require("node:fs");
const { expand } = require("./platform");
const { findExecutable, run } = require("./env");

function findApp(name, ctx) {
  const dirs = ctx.homeOverridden ? [expand(ctx, "~/Applications")] : ["/Applications", expand(ctx, "~/Applications")];
  for (const dir of dirs) {
    const app = ctx.path.join(dir, name);
    if (fs.existsSync(app)) return app;
  }
  return null;
}

async function appVersion(app) {
  const { error, stdout } = await run("/usr/bin/plutil", [
    "-extract",
    "CFBundleShortVersionString",
    "raw",
    "-o",
    "-",
    `${app}/Contents/Info.plist`,
  ]);
  return error ? null : stdout.trim();
}

async function commandVersion(file, detect, ctx) {
  if (!detect.versionArgs) return null;
  const opts = { timeout: 10000 };
  if (ctx.homeOverridden) opts.env = { ...process.env, HOME: ctx.home };
  const { error, stdout } = await run(file, detect.versionArgs, opts);
  if (error) return null;
  const m = stdout.match(new RegExp(detect.versionRegex ?? "(\\d+\\.\\d+\\.\\d+[\\w.-]*)"));
  return m ? m[1] : stdout.trim().split("\n")[0];
}

// envInfo: env.probeEnv() の結果
async function detectItem(item, ctx, envInfo) {
  const p = item.platforms[ctx.os];
  if (!p) return { id: item.id, state: "unsupported", detail: item.unsupportedReason?.[ctx.os] ?? null };
  const d = p.detect;
  const loginPath = envInfo.loginPath ?? envInfo.searchPath;
  const result = { id: item.id, state: "missing", version: null, path: null, appPath: null };

  // mac の Git。CLT が無いときに git を叩くと CLT のダイアログが出てしまうので、xcode-select -p で判定する。
  // CLT はシステム全体に入るものなので、仮のホームでも本物を見る
  if (d.xcodeClt) {
    if ((await run("/usr/bin/xcode-select", ["-p"])).error) return result;
    result.path = "/usr/bin/git";
    result.version = await commandVersion(result.path, d, ctx);
    return { ...result, state: "installed" };
  }

  if (d.app) {
    result.appPath = findApp(d.app, ctx);
    if (!result.appPath) return result;
    result.version = await appVersion(result.appPath);
    result.path = result.appPath;
    if (!d.command) return { ...result, state: "installed" };
  }

  if (d.command) {
    const onPath = findExecutable(d.command, loginPath, ctx);
    const known = (d.knownPaths ?? [])
      .filter((k) => !ctx.homeOverridden || /^[~%]/.test(k)) // 仮のホームでは、システム側の置き場を見ない
      .map((k) => ctx.path.dirname(expand(ctx, k)));
    const elsewhere = onPath ?? findExecutable(d.command, [...known, ...envInfo.searchPath], ctx);
    const file = onPath ?? elsewhere;
    if (file) {
      result.path = file;
      result.version ??= await commandVersion(file, d, ctx);
    }
    if (onPath) return { ...result, state: "installed" };
    // アプリはあるが CLI が無い・見えない、または CLI はあるが PATH が通っていない
    if (result.appPath || elsewhere) return { ...result, state: "installedNotOnPath" };
    return result;
  }

  // コマンドを持たない項目（Windows のアプリなど）は既知の置き場所だけを見る
  const found = (d.knownPaths ?? []).map((k) => expand(ctx, k)).find((f) => fs.existsSync(f));
  return found ? { ...result, state: "installed", path: found } : result;
}

async function detectAll(items, ctx, envInfo) {
  return Promise.all(items.map((item) => detectItem(item, ctx, envInfo)));
}

module.exports = { detectItem, detectAll };
