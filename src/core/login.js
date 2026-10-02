// ログイン。ログインそのものはブラウザで行うので、ターミナルを開いてカタログの login.command を流すだけにする
// （node-pty で画面に埋め込まない）。終わったかどうかは login.status を数秒ごとに叩いて知る。
//
//   login.command: ["claude", "auth", "login"]
//   login.status:  { command: [...], loggedInExitCode: 0 } または { command: [...], loggedInPattern: "正規表現" }

const fs = require("node:fs");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { findExecutable, childEnv } = require("./env");

// コマンド名を実際のファイルにする。判定で見つかった場所を優先する
function resolveCommand(name, item, detection, ctx, envInfo) {
  const p = item.platforms[ctx.os];
  if (detection?.path && p?.detect.command === name) return detection.path;
  return findExecutable(name, envInfo.searchPath, ctx);
}

// 戻り値: { loggedIn: boolean | null, detail? }（null は調べられなかった）
function loginStatus(item, ctx, envInfo, detection, { timeoutMs = 15000 } = {}) {
  const status = item.login?.status;
  if (!status) return Promise.resolve({ loggedIn: null });
  const [name, ...args] = status.command;
  const file = resolveCommand(name, item, detection, ctx, envInfo);
  if (!file) return Promise.resolve({ loggedIn: null, detail: `${name} が見つかりません` });
  return new Promise((resolve) => {
    execFile(file, args, { env: childEnv(ctx, envInfo), timeout: timeoutMs, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error?.killed) return resolve({ loggedIn: null, detail: "時間切れ" });
      if (error && typeof error.code !== "number") return resolve({ loggedIn: null, detail: error.message });
      const code = error ? error.code : 0;
      if (status.loggedInPattern) return resolve({ loggedIn: new RegExp(status.loggedInPattern).test(`${stdout}${stderr}`) });
      resolve({ loggedIn: code === (status.loggedInExitCode ?? 0) });
    });
  });
}

// シェルの1語として安全に書く
const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// mac のターミナルで流すスクリプト。PATH は判定に使ったもの（新しいターミナルと同じ）にする
function loginScript(item, file, args, ctx, envInfo) {
  const lines = [
    "#!/bin/zsh",
    `export PATH=${shQuote(envInfo.searchPath.join(":"))}`,
    ...(ctx.homeOverridden ? [`export HOME=${shQuote(ctx.home)}`] : []),
    `cd ${shQuote(ctx.home)}`,
    "clear",
    `echo ${shQuote(`${item.name} にログインします。ブラウザが開いたら、画面の案内に従ってください。`)}`,
    "echo",
    [file, ...args].map(shQuote).join(" "),
    "echo",
    `echo ${shQuote("終わったら、このウィンドウを閉じて AI Setup に戻ってください。")}`,
  ];
  return `${lines.join("\n")}\n`;
}

// ターミナルを開いてログインを始める。dir はスクリプトを置く場所（アプリの userData）
async function openLogin(item, ctx, envInfo, detection, dir) {
  const [name, ...args] = item.login.command;
  const file = resolveCommand(name, item, detection, ctx, envInfo);
  if (!file) throw new Error(`${name} が見つかりません`);
  if (ctx.os === "win32") {
    // 新しい PowerShell のウィンドウで流す（終わっても閉じない）
    const cmd = `& ${[file, ...args].map((a) => `'${a.replace(/'/g, "''")}'`).join(" ")}`;
    spawn("cmd.exe", ["/c", "start", '""', "powershell.exe", "-NoExit", "-Command", cmd], {
      env: childEnv(ctx, envInfo),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, `login-${item.id}.command`);
  fs.writeFileSync(script, loginScript(item, file, args, ctx, envInfo), { mode: 0o755 });
  fs.chmodSync(script, 0o755);
  await new Promise((resolve, reject) =>
    execFile("/usr/bin/open", ["-a", "Terminal", script], (e) => (e ? reject(new Error(`ターミナルを開けませんでした: ${e.message}`)) : resolve())),
  );
}

module.exports = { loginStatus, openLogin, loginScript, shQuote };
