// コマンドの探し方。Finder から起動したアプリの PATH は /usr/bin:/bin:… しか無いので、
// 利用者が新しいターミナルを開いたときの PATH（ログインシェルに聞く）を基準にする。

const fs = require("node:fs");
const { execFile } = require("node:child_process");
const { expand } = require("./platform");

const MARK = "__AISETUP_PATH__";
const MINIMAL_PATH = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: "utf8", timeout: 5000, ...opts }, (error, stdout) => resolve({ error, stdout: stdout ?? "" }));
  });
}

// 新しいターミナルで見える PATH。取れなければ null
async function loginShellPath(ctx) {
  if (ctx.os === "win32") {
    // 起動中のプロセスは古い PATH を持っているので、レジストリ（マシン＋ユーザー）から読み直す
    const ps =
      "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')";
    const { error, stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps]);
    return error ? null : stdout.trim().split(";").filter(Boolean);
  }
  const shell = process.env.SHELL || "/bin/zsh";
  // ターミナルと同じく、launchd の最小の PATH から始める（このプロセスの PATH を引き継がない）
  const env = { ...process.env, HOME: ctx.home, PATH: MINIMAL_PATH.join(":") };
  // ターミナルが開くのは対話ログインシェル。.zshrc で PATH を足す人もいるので -i も付ける。
  // 対話用の設定が固まる・失敗する環境に備えて、ログインだけでもう一度試す
  for (const flags of ["-ilc", "-lc"]) {
    const { error, stdout } = await run(shell, [flags, `printf '${MARK}%s${MARK}' "$PATH"`], { env });
    const m = stdout.match(new RegExp(`${MARK}(.*)${MARK}`));
    if (!error && m) return m[1].split(":").filter(Boolean);
  }
  return null;
}

// ログインシェルの PATH に無くても探す場所（公式インストーラの既定の置き場）
// 仮のホーム（AISETUP_HOME）では、システム側に入っている既存のものを見ない
function knownBinDirs(ctx) {
  if (ctx.os === "win32") {
    return ["~\\.local\\bin", "%LOCALAPPDATA%\\Programs\\OpenAI\\Codex\\bin", "%APPDATA%\\npm"].map((d) => expand(ctx, d));
  }
  const system = ctx.homeOverridden ? [] : ["/opt/homebrew/bin", "/usr/local/bin"];
  return [expand(ctx, "~/.local/bin"), ...system, ...MINIMAL_PATH];
}

const uniq = (a) => [...new Set(a)];

// { loginPath: string[] | null, searchPath: string[] }
async function probeEnv(ctx) {
  const loginPath = await loginShellPath(ctx);
  const current = ctx.homeOverridden ? [] : (process.env.PATH ?? "").split(ctx.path.delimiter).filter(Boolean);
  return { loginPath, searchPath: uniq([...(loginPath ?? []), ...knownBinDirs(ctx), ...current]) };
}

function isExecutable(file, ctx) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return false;
    if (ctx.os !== "win32") fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// dirs の中から name を探す（Windows は拡張子を補う）。見つからなければ null
function findExecutable(name, dirs, ctx) {
  const exts = ctx.os === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = ctx.path.join(dir, name + ext);
      if (isExecutable(file, ctx)) return file;
    }
  }
  return null;
}

// インストーラなど子プロセスに渡す環境変数
function childEnv(ctx, envInfo, extra = {}) {
  const env = { ...process.env, NO_COLOR: "1", ...extra };
  env.PATH = envInfo.searchPath.join(ctx.path.delimiter);
  if (ctx.homeOverridden) {
    env.HOME = ctx.home;
    if (ctx.os === "win32") Object.assign(env, ctx.vars);
  }
  return env;
}

module.exports = { probeEnv, loginShellPath, knownBinDirs, findExecutable, childEnv, run };
