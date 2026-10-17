// カタログの1項目と実行環境から、実行する手順（Step[]）を組み立てる。副作用は無い。
//
// Step の種類（実行は runner.js）:
//   download      { url, dest, hash?, addBom?, size? }
//   spawn         { cmd, args, env?, elevate?, askpass? }  … askpass: sudo のパスワードを OS の入力画面で聞く（その文言）
//   unzip         { archive, dest }
//   verifyMacApp  { app, teamId }
//   installMacApp { src, name }            … 置いた場所を変数 appPath に入れる
//   symlink       { target, link }
//   ensurePath    { dir }
//   untar         { archive, dest }        … tar.gz を展開する
//   installDir    { src, dest }            … 展開したフォルダを置く（同じ版が既にあれば置き換える）
//   xcodeClt      {}                       … Xcode のコマンドライン・ツールを入れる（OS のダイアログが出る）
//   backup        { files }                … あるものだけ <file>.bak-YYYYMMDD に退避する
//   mountDmg      { dmg, mountpoint }      … 読み取り専用でマウントする（外し忘れは runner が最後に外す）
//   unmountDmg    { mountpoint }
//   shellenv      { brew }                 … シェル設定に eval "$(<brew> shellenv)" を足す（Homebrew）
//   spawn の timeoutMs は省略時 20 分
// 文字列中の {tmp}（項目ごとの一時ディレクトリ）と {appPath} は、実行時に埋める。

const strategies = require("./strategies");
const { expand, hubDir } = require("./platform");

function postInstallSteps(item, ctx) {
  const p = item.platforms[ctx.os];
  const steps = [];
  for (const entry of p.postInstall ?? []) {
    if (entry.ensurePath) {
      steps.push({ kind: "ensurePath", dir: expand(ctx, entry.ensurePath) });
    } else if (entry.linkBin) {
      // 公式インストーラが自分の場所（~/.grok/bin など）に置いたコマンドを、~/.local/bin から指す
      const target = expand(ctx, entry.linkBin);
      steps.push({ kind: "symlink", target, link: ctx.path.join(hubDir(ctx), ctx.path.basename(target)) });
    } else if (entry.brewShellenv) {
      // Homebrew の置き場は Apple Silicon と Intel で違う
      steps.push({ kind: "shellenv", brew: entry.brewShellenv[ctx.arch] ?? entry.brewShellenv.x64 });
    } else if (entry.cliShim) {
      const { name, target } = entry.cliShim;
      // Paseo アプリ自身が「CLI を入れる」で作るのと同じ形（~/.local/bin/<name> → アプリ内の実体）
      steps.push({
        kind: "symlink",
        target: ctx.path.join("{appPath}", target),
        link: ctx.path.join(hubDir(ctx), name),
      });
    }
  }
  return steps;
}

// 入っているのに PATH が通っていないコマンドを、使えるようにする手順。
// mac は ~/.local/bin へ symlink を貼る（Homebrew の bin などを丸ごと PATH に足すと、ほかのコマンドまで見えてしまう）。
// Windows は symlink に権限が要るので、見つかった場所を PATH に足す。
function exposeSteps(ctx, foundPath) {
  const dir = ctx.path.dirname(foundPath);
  if (ctx.os === "win32") return [{ kind: "ensurePath", dir }];
  if (dir === hubDir(ctx)) return []; // ~/.local/bin にあるなら、PATH に足すだけで直る
  return [{ kind: "symlink", target: foundPath, link: ctx.path.join(hubDir(ctx), ctx.path.basename(foundPath)) }];
}

// mode: "install"（入れてから後処理）/ "fixPath"（入っているので後処理だけ）
// foundPath: fixPath のとき、実際に見つかったコマンド（Homebrew など既定と違う場所もある）
function planItem(item, ctx, release, { mode = "install", foundPath = null } = {}) {
  const p = item.platforms[ctx.os];
  if (!p) return { id: item.id, unsupported: true, steps: [] };
  const install = mode === "install" ? strategies[p.install.strategy](p.install, ctx, release, item) : [];
  let post = postInstallSteps(item, ctx);
  // shellenv で PATH を通すもの（Homebrew）は、コマンドだけを ~/.local/bin に貼っても意味が無い
  if (mode === "fixPath" && foundPath && !post.some((s) => s.kind === "shellenv")) {
    const expose = exposeSteps(ctx, foundPath);
    const has = (s) => post.some((q) => q.kind === s.kind && q.dir === s.dir && q.link === s.link);
    post = [...expose.filter((s) => !has(s)), ...post];
  }
  return {
    id: item.id,
    version: release?.version,
    pinned: !!release?.pinned,
    admin: !!p.install.elevate || !!p.install.admin,
    steps: [...install, ...post],
  };
}

// 人に見せる1行の説明（ドライランとログで使う）
function describeStep(step) {
  switch (step.kind) {
    case "download":
      return `ダウンロード ${step.url} → ${step.dest}${step.hash ? `（${step.hash.algo === "ed25519" ? "ed25519 の署名" : `${step.hash.algo} `}を確認）` : ""}`;
    case "spawn":
      return `${step.elevate || step.askpass ? "[管理者] " : ""}実行 ${[step.cmd, ...step.args].join(" ")}${
        step.env && Object.keys(step.env).length
          ? `（${Object.entries(step.env).map(([k, v]) => `${k}=${v}`).join(" ")}）`
          : ""
      }`;
    case "unzip":
      return `展開 ${step.archive} → ${step.dest}`;
    case "verifyMacApp":
      return `署名と公証を確認 ${step.app}${step.teamId ? `（チーム ID ${step.teamId}）` : ""}`;
    case "installMacApp":
      return `アプリを配置 ${step.name} → /Applications${step.systemOnly ? "" : "（書けなければ ~/Applications）"}`;
    case "mountDmg":
      return `マウント ${step.dmg} → ${step.mountpoint}`;
    case "unmountDmg":
      return `マウントを外す ${step.mountpoint}`;
    case "symlink":
      return `リンク ${step.link} → ${step.target}`;
    case "ensurePath":
      return `PATH に追加 ${step.dir}`;
    case "untar":
      return `展開 ${step.archive} → ${step.dest}`;
    case "installDir":
      return `配置 ${step.src} → ${step.dest}`;
    case "xcodeClt":
      return "Xcode のコマンドライン・ツールを入れる（画面に出るダイアログで「インストール」を押す）";
    case "shellenv":
      return `シェル設定に追加 eval "$(${step.brew} shellenv)"`;
    case "backup":
      return `退避 ${step.files.join(" ")}（あるものだけ .bak-YYYYMMDD に）`;
    default:
      return `${step.kind} ${JSON.stringify(step)}`;
  }
}

module.exports = { planItem, postInstallSteps, describeStep, hubDir };
