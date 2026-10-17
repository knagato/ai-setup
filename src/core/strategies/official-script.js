// 公式のインストールスクリプト（curl … | sh や irm … | iex で案内されているもの）を、
// 一度ファイルに落としてから実行する。版の選択・検証・配置はスクリプトに任せる。
//
//   install.args:           スクリプトに渡す引数（非対話にする・シェル設定を書かせない など）
//   install.backupFiles:    止める手段が無くスクリプトが書き換えてしまうファイル。実行の前に退避する
//   install.timeoutMinutes: 時間のかかるもの（既定は 20 分）
//   install.askpass:        スクリプトが sudo を使うとき、パスワードを聞く画面の文言（SUDO_ASKPASS で OS の入力画面を出す）

const { expand } = require("../platform");

module.exports = function officialScript(install, ctx) {
  const env = install.env ?? {};
  const args = install.args ?? [];
  const before = install.backupFiles?.length ? [{ kind: "backup", files: install.backupFiles.map((f) => expand(ctx, f)) }] : [];
  const timeout = install.timeoutMinutes ? { timeoutMs: install.timeoutMinutes * 60 * 1000 } : {};
  const askpass = install.askpass ? { askpass: install.askpass } : {};
  if (install.shell === "powershell") {
    const script = ctx.path.join("{tmp}", "install.ps1");
    return [
      ...before,
      { kind: "download", url: install.url, dest: script, addBom: true },
      {
        kind: "spawn",
        cmd: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
        env,
        ...timeout,
      },
    ];
  }
  const script = ctx.path.join("{tmp}", "install.sh");
  return [
    ...before,
    { kind: "download", url: install.url, dest: script },
    { kind: "spawn", cmd: install.shell === "bash" ? "/bin/bash" : "/bin/sh", args: [script, ...args], env, ...timeout, ...askpass },
  ];
};
