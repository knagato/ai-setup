// npm のパッケージとして配られているコマンド（pnpm）。Node の版ごとのフォルダではなく
// ~/.local/share/ai-setup/npm-global に入れるので、Node を上げても消えない。コマンドは ~/.local/bin へリンクする。
// corepack は使わない（Node の版によって同梱されない・挙動が変わる）。

const { dataDir, hubDir } = require("../platform");

module.exports = function npmGlobal(install, ctx) {
  const p = ctx.path;
  const prefix = dataDir(ctx, "npm-global");
  return [
    { kind: "spawn", cmd: "npm", args: ["install", "--global", "--prefix", prefix, install.package] },
    ...install.bins.map((bin) => ({ kind: "symlink", target: p.join(prefix, "bin", bin), link: p.join(hubDir(ctx), bin) })),
  ];
};
