// zip で配られている macOS アプリ。ハッシュを確かめて展開し、署名（チーム ID）と公証を確かめてから
// /Applications（書けなければ ~/Applications）へ置く。

module.exports = function macAppZip(install, ctx, release) {
  const zip = ctx.path.join("{tmp}", "app.zip");
  const dir = ctx.path.join("{tmp}", "app");
  const app = ctx.path.join(dir, install.appName);
  return [
    { kind: "download", url: release.url, dest: zip, hash: release.hash, size: release.size },
    { kind: "unzip", archive: zip, dest: dir },
    { kind: "verifyMacApp", app, teamId: install.teamId },
    { kind: "installMacApp", src: app, name: install.appName },
  ];
};
