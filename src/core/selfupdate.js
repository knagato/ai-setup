// このアプリ自身の更新。electron-builder が書き出す latest-mac.yml / latest.yml を GitHub Releases から読み、
// 新しい版があれば取ってきて入れ替える。
//   mac     … zip を sha512 で確かめて展開し、署名・公証・チーム ID・bundle id・版を確かめる。
//              入れ替えはアプリが終わってから別プロセスのシェルが行い、新しい版を開き直す
//   Windows … インストーラを sha512 で確かめ、黙って入れる引数で実行する（入れ終わると開き直す）

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { parseUpdaterYaml, fetchText: defaultFetchText } = require("./resolvers");
const { runSteps } = require("./runner");
const { run } = require("./env");

const REPO = "knagato/ai-setup";
const BUNDLE_ID = "com.knatrix.aisetup";
const APP_NAME = "AI Setup.app"; // zip の中身（package.json の productName）
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

// "1.2.10" > "1.2.9"。プレリリース（1.0.0-beta など）は同じ版の正式版より古いとみなす
function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre] = String(v).replace(/^v/, "").split("-", 2);
    return { nums: core.split(".").map((n) => Number(n) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

const manifestName = (ctx) => (ctx.os === "win32" ? "latest.yml" : "latest-mac.yml");

function pickFile(manifest, ctx) {
  if (ctx.os === "win32") {
    const exes = manifest.files.filter((f) => f.url.toLowerCase().endsWith(".exe"));
    return exes.find((f) => f.url.includes(`-${ctx.arch}-`)) ?? exes[0] ?? null;
  }
  return manifest.files.find((f) => f.url.endsWith(`-${ctx.arch}-mac.zip`)) ?? null;
}

// 戻り値: { available: false, current, latest } または { available: true, current, latest, url, hash, size }
async function checkForUpdate(current, ctx, { fetchText = defaultFetchText } = {}) {
  const name = manifestName(ctx);
  const manifest = parseUpdaterYaml(await fetchText(`https://github.com/${REPO}/releases/latest/download/${name}`));
  if (!manifest.version) throw new Error(`${name} に version がありません`);
  if (compareVersions(manifest.version, current) <= 0) return { available: false, current, latest: manifest.version };
  const file = pickFile(manifest, ctx);
  if (!file?.sha512) throw new Error(`${name} にこのパソコン向けのファイルがありません（${ctx.os} ${ctx.arch}）`);
  return {
    available: true,
    current,
    latest: manifest.version,
    url: `https://github.com/${REPO}/releases/download/v${manifest.version}/${file.url}`,
    hash: { algo: "sha512", digest: file.sha512, encoding: "base64" },
    size: file.size,
  };
}

// 動いているアプリの .app（mac）。実行ファイルは <X>.app/Contents/MacOS/<name>
function appBundlePath(execPath) {
  const app = path.resolve(execPath, "..", "..", "..");
  return app.endsWith(".app") ? app : null;
}

// mac で入れ替えられない理由（入れ替えられるなら null）
function whyCannotReplace(appPath) {
  if (!appPath) return "アプリの場所が分かりません";
  if (appPath.includes("/AppTranslocation/") || appPath.startsWith("/Volumes/")) {
    return "ダウンロードした場所から直接開いています。AI Setup を「アプリケーション」フォルダに移してから開き直してください";
  }
  try {
    fs.accessSync(path.dirname(appPath), fs.constants.W_OK);
  } catch {
    return "このアカウントでは AI Setup を入れ替えられません。ダウンロードページから新しい版を入れてください";
  }
  return null;
}

function teamIdOf(app) {
  // codesign -dv は結果を標準エラーに出す。ad-hoc 署名は "TeamIdentifier=not set"
  return new Promise((resolve) =>
    execFile("/usr/bin/codesign", ["-dv", app], (e, so, se) => {
      const id = `${so}${se}`.match(/TeamIdentifier=(.+)/)?.[1].trim();
      resolve(id && id !== "not set" ? id : null);
    }),
  );
}

async function plistValue(app, key) {
  const plist = path.join(app, "Contents", "Info.plist");
  const { error, stdout } = await run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist]);
  return error ? null : stdout.trim();
}

// 新しい版を取ってきて確かめる。戻り値は launchUpdate に渡す
// opts: { ctx, appPath（mac）, onLog, onProgress, signal }
async function prepareUpdate(update, { ctx, appPath, onLog = () => {}, onProgress, signal }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "ai-setup-update-"));
  const opts = { ctx, onLog, onProgress, signal };
  try {
    if (ctx.os === "win32") {
      const installer = path.join(work, update.url.split("/").pop());
      await runSteps([{ kind: "download", url: update.url, dest: installer, hash: update.hash, size: update.size }], opts);
      return { os: "win32", installer, work };
    }
    const zip = path.join(work, "update.zip");
    const dir = path.join(work, "new");
    const newApp = path.join(dir, APP_NAME);
    // 今の版と同じチームの署名であること（今の版が ad-hoc 署名なら、公証が通ることだけを確かめる）
    const teamId = await teamIdOf(appPath);
    await runSteps(
      [
        { kind: "download", url: update.url, dest: zip, hash: update.hash, size: update.size },
        { kind: "unzip", archive: zip, dest: dir },
        { kind: "verifyMacApp", app: newApp, teamId },
      ],
      opts,
    );
    const bundleId = await plistValue(newApp, "CFBundleIdentifier");
    if (bundleId !== BUNDLE_ID) throw new Error(`別のアプリが入っています（${bundleId ?? "bundle id なし"}）`);
    const version = await plistValue(newApp, "CFBundleShortVersionString");
    if (version !== update.latest) throw new Error(`版が違います（期待 ${update.latest}、実際 ${version ?? "なし"}）`);
    fs.rmSync(zip, { force: true });
    return { os: "darwin", newApp, work };
  } catch (e) {
    fs.rmSync(work, { recursive: true, force: true });
    throw e;
  }
}

// アプリ（pid）が終わるのを待ってから入れ替え、開き直す。入れ替えに失敗したら元の版に戻して開く
const SWAP_SCRIPT = `
pid=$1 app=$2 new=$3 work=$4
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 300 ]; then echo "アプリが終わらないので入れ替えをやめます"; exit 1; fi
  sleep 0.2
done
if mv "$app" "$work/old.app"; then
  if mv "$new" "$app"; then
    rm -rf "$work"
    echo "入れ替えました: $app"
  else
    echo "新しい版を置けなかったので元に戻します"
    rm -rf "$app"
    mv "$work/old.app" "$app"
  fi
else
  echo "今の版を退かせなかったので、入れ替えをやめます"
fi
open "$app"
`;

function swapCommand({ pid, appPath, newApp, work }) {
  return { cmd: "/bin/sh", args: ["-c", SWAP_SCRIPT, "ai-setup-update", String(pid), appPath, newApp, work] };
}

// 呼んだ側はこのあとすぐ終わること（mac は終わるのを待ってから入れ替える）
// opts: { pid, appPath（mac）, log（入れ替えの記録を書くファイル）, env? }
function launchUpdate(prepared, { pid, appPath, log, env }) {
  if (prepared.os === "win32") {
    // --updated: 更新として入れる / --force-run: 入れ終わったら開く（electron-builder の NSIS の引数）
    spawn(prepared.installer, ["/S", "--updated", "--force-run"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return;
  }
  const { cmd, args } = swapCommand({ pid, appPath, newApp: prepared.newApp, work: prepared.work });
  const out = fs.openSync(log, "a");
  spawn(cmd, args, { detached: true, stdio: ["ignore", out, out], env: env ?? { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" } }).unref();
  fs.closeSync(out);
}

module.exports = {
  compareVersions,
  pickFile,
  checkForUpdate,
  appBundlePath,
  whyCannotReplace,
  prepareUpdate,
  swapCommand,
  launchUpdate,
  RELEASES_PAGE,
};
