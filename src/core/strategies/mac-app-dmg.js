// dmg で配られている macOS アプリ。照合してから読み取り専用でマウントし、署名（チーム ID）と公証を確かめて
// /Applications（書けなければ ~/Applications）へ置く。マウントは最後に外す（途中で失敗しても runner が外す）。
//
//   install.systemOnly: /Applications にしか置けないアプリ（Docker Desktop）。書けなければ ~/Applications に逃がさず止める

module.exports = function macAppDmg(install, ctx, release) {
  const dmg = ctx.path.join("{tmp}", "app.dmg");
  const mountpoint = ctx.path.join("{tmp}", "mnt");
  const app = ctx.path.join(mountpoint, install.appName);
  return [
    { kind: "download", url: release.url, dest: dmg, hash: release.hash, size: release.size },
    { kind: "mountDmg", dmg, mountpoint },
    { kind: "verifyMacApp", app, teamId: install.teamId },
    { kind: "installMacApp", src: app, name: install.appName, ...(install.systemOnly ? { systemOnly: true } : {}) },
    { kind: "unmountDmg", mountpoint },
  ];
};
