// 実行環境（OS・アーキテクチャ・ホーム）を ctx にまとめる。
// パスはすべて ctx から組み立てるので、テストやドライランで別の OS・別のホームを装える。
//   AISETUP_HOME=/tmp/fakehome … 実際のホームを汚さずに試す（/Applications にも書かない）

const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// Rosetta 下で動く x64 ビルドでも、実機が Apple Silicon なら arm64 版を入れる
function realArch(platform = process.platform, arch = process.arch) {
  if (platform === "darwin" && arch === "x64") {
    try {
      const out = execFileSync("/usr/sbin/sysctl", ["-in", "sysctl.proc_translated"], { encoding: "utf8" });
      if (out.trim() === "1") return "arm64";
    } catch {}
  }
  return arch;
}

function makeContext({ os: platform = process.platform, arch, home, env = process.env } = {}) {
  const override = home ?? env.AISETUP_HOME;
  const p = platform === "win32" ? path.win32 : path.posix;
  // 別の OS の計画を見るときは、その OS らしいホームを仮に置く
  const foreignHome =
    platform === "win32" ? `C:\\Users\\${os.userInfo().username}` : `/Users/${os.userInfo().username}`;
  const h = override ?? (platform === process.platform ? os.homedir() : foreignHome);
  // 別のホームを装うとき・別の OS の計画を出すときは、環境変数ではなくホームから組み立てる
  const useEnv = !override && platform === process.platform;
  const vars = {
    USERPROFILE: h,
    LOCALAPPDATA: (useEnv && env.LOCALAPPDATA) || p.join(h, "AppData", "Local"),
    APPDATA: (useEnv && env.APPDATA) || p.join(h, "AppData", "Roaming"),
  };
  return {
    os: platform,
    arch: arch ?? (platform === process.platform ? realArch(platform) : "x64"),
    home: h,
    homeOverridden: !!override,
    path: p,
    vars,
  };
}

// "~/x" と "%LOCALAPPDATA%\x" を展開する
function expand(ctx, s) {
  let out = s.replace(/%([A-Z_]+)%/g, (m, name) => ctx.vars[name] ?? m);
  if (out === "~") return ctx.home;
  if (out.startsWith("~/") || out.startsWith("~\\")) out = ctx.path.join(ctx.home, out.slice(2));
  return out;
}

// コマンドを集める場所。PATH に足すのはここ1か所だけにして、個々のツールはここへ symlink を貼る
const hubDir = (ctx) => expand(ctx, ctx.path.join("~", ".local", "bin"));

// AI Setup が自分で置くもの（gh・Node など）の置き場。<id>/<version> と、使う版を指す <id>/current
const dataDir = (ctx, ...parts) => expand(ctx, ctx.path.join("~", ".local", "share", "ai-setup", ...parts));

module.exports = { makeContext, expand, realArch, hubDir, dataDir };
