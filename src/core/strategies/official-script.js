// 公式のインストールスクリプト（curl … | sh や irm … | iex で案内されているもの）を、
// 一度ファイルに落としてから実行する。版の選択・検証・配置はスクリプトに任せる。

module.exports = function officialScript(install, ctx) {
  const env = install.env ?? {};
  if (install.shell === "powershell") {
    const script = ctx.path.join("{tmp}", "install.ps1");
    return [
      { kind: "download", url: install.url, dest: script, addBom: true },
      {
        kind: "spawn",
        cmd: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
        env,
      },
    ];
  }
  const script = ctx.path.join("{tmp}", "install.sh");
  return [
    { kind: "download", url: install.url, dest: script },
    { kind: "spawn", cmd: install.shell === "bash" ? "/bin/bash" : "/bin/sh", args: [script], env },
  ];
};
