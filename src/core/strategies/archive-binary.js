// アーカイブ（zip / tar.gz）で配られているコマンド。ハッシュを確かめて ~/.local/share/ai-setup/<id>/<version> に置き、
// <id>/current をその版へ向け、使うコマンドを ~/.local/bin へリンクする（版を上げても ~/.local/bin のリンクは変わらない）。
//
//   install.format: "zip" | "tar.gz"
//   install.root:   アーカイブの中の最上位フォルダ（{version} と {arch} を埋める。arch は配布元の呼び方）
//   install.bins:   root からの相対パス。basename の名前で ~/.local/bin に並ぶ

const { dataDir, hubDir } = require("../platform");

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

module.exports = function archiveBinary(install, ctx, release, item) {
  const p = ctx.path;
  const vars = { version: release.version, arch: release.arch ?? ctx.arch };
  const archive = p.join("{tmp}", release.url.split("/").pop());
  const out = p.join("{tmp}", "x");
  const dest = dataDir(ctx, item.id, release.version);
  const current = dataDir(ctx, item.id, "current");
  return [
    { kind: "download", url: release.url, dest: archive, hash: release.hash, size: release.size },
    { kind: install.format === "zip" ? "unzip" : "untar", archive, dest: out },
    { kind: "installDir", src: p.join(out, fill(install.root, vars)), dest },
    { kind: "symlink", target: dest, link: current },
    ...install.bins.map((bin) => ({ kind: "symlink", target: p.join(current, bin), link: p.join(hubDir(ctx), p.basename(bin)) })),
  ];
};
