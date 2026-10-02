// シェル設定への PATH の追加: 何度実行しても同じ結果になること、退避すること、既存の内容を壊さないこと。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ensurePathDarwin, profileFor } = require("../src/core/pathfix.js");
const { makeContext } = require("../src/core/platform.js");

const fresh = () => makeContext({ os: "darwin", home: fs.mkdtempSync(path.join(os.tmpdir(), "aisetup-home-")) });
const now = new Date(2026, 9, 2, 21, 30, 5);

test("シェルごとの書き込み先", () => {
  const ctx = makeContext({ os: "darwin", home: "/Users/u" });
  assert.equal(profileFor(ctx, "/bin/zsh"), "/Users/u/.zprofile");
  assert.equal(profileFor(ctx, "/bin/bash"), "/Users/u/.bash_profile");
  assert.equal(profileFor(ctx, "/usr/local/bin/fish"), "/Users/u/.profile");
});

test("ファイルが無ければ作り、2回目は何もしない", () => {
  const ctx = fresh();
  const dir = path.join(ctx.home, ".local/bin");
  const r1 = ensurePathDarwin(ctx, dir, { shell: "/bin/zsh", now });
  assert.equal(r1.changed, true);
  assert.equal(r1.backup, null);
  const text = fs.readFileSync(r1.file, "utf8");
  assert.match(text, /export PATH="\$HOME\/\.local\/bin:\$PATH"/);
  const r2 = ensurePathDarwin(ctx, dir, { shell: "/bin/zsh", now });
  assert.equal(r2.changed, false);
  assert.equal(fs.readFileSync(r1.file, "utf8"), text);
});

test("既存の内容は残し、退避してから追記する。ブロックは1つだけ", () => {
  const ctx = fresh();
  const file = path.join(ctx.home, ".zprofile");
  fs.writeFileSync(file, 'eval "$(/opt/homebrew/bin/brew shellenv)"');
  ensurePathDarwin(ctx, path.join(ctx.home, ".local/bin"), { shell: "/bin/zsh", now });
  ensurePathDarwin(ctx, "/opt/homebrew/bin", { shell: "/bin/zsh", now });
  const text = fs.readFileSync(file, "utf8");
  assert.ok(text.startsWith('eval "$(/opt/homebrew/bin/brew shellenv)"\n\n# >>> ai-setup >>>'));
  assert.equal(text.match(/>>> ai-setup >>>/g).length, 1);
  // 先に足したもの（.local/bin）が PATH の前に来るよう、後ろの行に置く
  assert.ok(text.indexOf("/opt/homebrew/bin:$PATH") < text.indexOf("$HOME/.local/bin:$PATH"));
  // 1回目は .bak-20261002、同じ日の2回目は時刻付き
  assert.equal(fs.readFileSync(`${file}.bak-20261002`, "utf8"), 'eval "$(/opt/homebrew/bin/brew shellenv)"');
  assert.ok(fs.existsSync(`${file}.bak-20261002-213005`));
});
