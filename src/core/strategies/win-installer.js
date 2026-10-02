// Windows のインストーラ（exe / msi）を、黙って入れる引数で実行する。
// elevate: true のものは UAC を通して実行する（そのあいだは中断できない）。

module.exports = function winInstaller(install, ctx, release) {
  const file = ctx.path.join("{tmp}", release.url.split("/").pop());
  const isMsi = file.toLowerCase().endsWith(".msi");
  const cmd = isMsi ? "msiexec.exe" : file;
  const args = isMsi ? ["/i", file, ...(install.args ?? [])] : (install.args ?? []);
  return [
    { kind: "download", url: release.url, dest: file, hash: release.hash, size: release.size },
    { kind: "spawn", cmd, args, elevate: !!install.elevate },
  ];
};
