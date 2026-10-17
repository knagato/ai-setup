// macOS のシェル設定に PATH を足す。印の付いたブロックを1つだけ持ち、何度実行しても同じ結果になる。
// 書き換える前に元のファイルを <file>.bak-YYYYMMDD に退避する。
//
//   # >>> ai-setup >>>
//   eval "$(/opt/homebrew/bin/brew shellenv)"   … Homebrew を入れたときだけ（PATH を1か所に絞る決まりの例外）
//   export PATH="$HOME/.local/bin:$PATH"
//   # <<< ai-setup <<<
//
// eval の行を先に書くので、~/.local/bin が Homebrew の bin より前に来る（AI Setup が入れたものが優先される）

const fs = require("node:fs");
const path = require("node:path");

const BEGIN = "# >>> ai-setup >>>";
const END = "# <<< ai-setup <<<";
const NOTE = "# AI Setup が追加した PATH（このブロックは AI Setup が書き換えます）";

// Codex のインストーラと同じ選び方（Homebrew の案内に合わせたもの）
function profileFor(ctx, shell = process.env.SHELL ?? "/bin/zsh") {
  const name = path.basename(shell);
  if (name === "bash") return path.join(ctx.home, ".bash_profile");
  if (name === "zsh") return path.join(ctx.home, ".zprofile");
  return path.join(ctx.home, ".profile");
}

const stamp = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

// 同じ日に2回目なら時刻を付けて、前の退避を上書きしない
function backupPath(file, now = new Date()) {
  let dest = `${file}.bak-${stamp(now)}`;
  if (fs.existsSync(dest)) {
    const t = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0")).join("");
    dest = `${dest}-${t}`;
  }
  return dest;
}

function backup(file, now) {
  if (!fs.existsSync(file)) return null;
  const dest = backupPath(file, now);
  fs.copyFileSync(file, dest);
  return dest;
}

const toShell = (dir, home) => (dir === home || dir.startsWith(home + "/") ? `$HOME${dir.slice(home.length)}` : dir);
const fromShell = (s, home) => s.replace(/^\$HOME(?=\/|$)/, home);

function readBlock(text, home) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END, start);
  if (start < 0 || end < 0) return null;
  const body = text.slice(start + BEGIN.length, end);
  const dirs = [...body.matchAll(/^export PATH="(.+):\$PATH"$/gm)].map((m) => fromShell(m[1], home));
  const shellenvs = [...body.matchAll(/^eval "\$\((.+) shellenv\)"$/gm)].map((m) => m[1]);
  return { start, end: end + END.length, dirs, shellenvs };
}

function renderBlock({ dirs, shellenvs }, home) {
  // 後に書いた行ほど PATH の前に来る。先に足したものを優先したいので逆順に並べる
  const exports = [...dirs].reverse().map((d) => `export PATH="${toShell(d, home)}:$PATH"`);
  const evals = shellenvs.map((brew) => `eval "$(${brew} shellenv)"`);
  return [BEGIN, NOTE, ...evals, ...exports, END].join("\n");
}

// ブロックを読み、update(block) が返した中身で書き直す。update が null を返したら何もしない。
// 戻り値: { changed, file, backup }
function updateBlock(ctx, update, { shell, now = new Date() } = {}) {
  const file = profileFor(ctx, shell);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const block = readBlock(text, ctx.home);
  const wanted = update({ dirs: block?.dirs ?? [], shellenvs: block?.shellenvs ?? [] });
  if (!wanted) return { changed: false, file, backup: null };

  const rendered = renderBlock(wanted, ctx.home);
  const next = block
    ? text.slice(0, block.start) + rendered + text.slice(block.end)
    : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${text ? "\n" : ""}${rendered}\n`;
  const saved = backup(file, now);
  fs.writeFileSync(file, next);
  return { changed: true, file, backup: saved };
}

function ensurePathDarwin(ctx, dir, opts) {
  return updateBlock(ctx, (b) => (b.dirs.includes(dir) ? null : { ...b, dirs: [...b.dirs, dir] }), opts);
}

// Homebrew の bin を PATH に足す（brew shellenv。Homebrew 自身が案内している書き方）
function ensureShellenvDarwin(ctx, brew, opts) {
  return updateBlock(ctx, (b) => (b.shellenvs.includes(brew) ? null : { ...b, shellenvs: [...b.shellenvs, brew] }), opts);
}

module.exports = { ensurePathDarwin, ensureShellenvDarwin, profileFor, backup, backupPath, readBlock, BEGIN, END };
