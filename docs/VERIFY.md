# 動作確認の手順

## 毎回
1. `pnpm test`
2. `pnpm run plan` と `pnpm run plan -- --os win32 --arch arm64 --offline` で手順を目で確かめる
3. 仮のホームで実際に入れる（システム側の既存インストールは見ないので、全部「未インストール」から始まる）
   ```sh
   rm -rf /tmp/h && mkdir /tmp/h
   AISETUP_HOME=/tmp/h node src/cli.js install     # 1回目: 入る
   AISETUP_HOME=/tmp/h node src/cli.js install     # 2回目: 全部「飛ばします」
   HOME=/tmp/h PATH=/usr/bin:/bin:/usr/sbin:/sbin zsh -ilc 'which claude codex paseo'
   ```
4. 画面: `AISETUP_HOME=/tmp/h2 pnpm start -- --remote-debugging-port=19223` を起動し、CDP で各画面を確かめる

## アプリ自身の更新
- `pnpm test`（版の比較・マニフェストの読み方・入れ替えのシェル）
- 画面: CDP で `state.update = { available: true, current: "0.1.0", latest: "0.2.0", blocker: null }; renderUpdate()` を評価すると帯が出る
- 通しの確認は、公証済みの版が2つ要る（ad-hoc 署名の版は公証の確認で弾かれる）:
  1. v(N) を `release` で作って公開し、dmg から /Applications に入れる
  2. `version` を上げて v(N+1) を `release` で作って公開する
  3. v(N) を開くと帯が出る →「更新する」→ 開き直して v(N+1) になっている。記録は `~/Library/Application Support/AI Setup/update.log`

## リリース前（実機）
- 新しい macOS ユーザー（標準ユーザー / 管理者ユーザー）で、dmg をブラウザから落として入れる
- 新しいターミナルで `claude --version` / `codex --version` / `paseo --version` が通る
- 同じく `git --version` / `gh --version` / `node --version` / `npm --version` / `pnpm --version` が通る
- Xcode のコマンドライン・ツールが無い Mac で、Git を選ぶと OS のダイアログが出て、入り終わると「完了」になる（標準ユーザーでも）
- ログイン画面で「ログインする」→ ターミナルとブラウザが開き、終わると数秒で「ログイン済み」になる（claude / codex / gh / composio）
- 既存の `~/.zprofile` が退避（`.bak-YYYYMMDD`）され、ai-setup ブロックが1つだけ入っている
- Windows: Windows Sandbox（x64）と ARM の VM。インストーラはブラウザ経由で落とし、SmartScreen が出るところから

## 確認済み（2026-10-18, macOS arm64, Docker Desktop と OrbStack）
- 仮のホームへの実インストール: Docker Desktop 4.95.0（562.6 MB、checksums.txt の sha256）/ OrbStack 2.2.4（447.8 MB、ed25519 の署名）。
  どちらも dmg をマウント → 署名・公証・チーム ID → `~/Applications` に置き、マウントは残らない。2回目は全部飛ばす
- 画面: 選ぶ画面に「アプリを動かす箱（コンテナ）」、完了画面に「最初に一度開く」と2つのボタン
- 未確認: 実際に開いたあとの初回の設定（Docker の利用規約への同意・OrbStack の管理者パスワードは任意）、Intel Mac、macOS 13 で「選べない」になること

## 確認済み（2026-10-17, macOS 27 arm64, Mac mini 実機・CLT なし・管理者ユーザー）
- まっさらな Mac に ad-hoc 署名の .app を scp で置いて起動（隔離属性が付かないので Gatekeeper は出ない）。環境チェックは 15 個すべて「未インストール」、CLT のダイアログは出ない
- 1回目（旧版）: Git の CLT ダイアログを誰も押さず、60 分待って失敗。その間、後ろの項目（Tailscale）も止まっていた。ほかの 8 個は入った。
  新しいターミナルで claude / codex / grok / paseo / gh / node / npm / pnpm が通り、`.zprofile` に ai-setup のブロックが1つだけ（元のファイルは無かった）
- 裏で待つ・知らせる: Git（と、Git に依存する Hermes）だけを流すと、Git は最初に始まり、Hermes は「Git が入り終わるのを待っています」。
  ダイアログを出したときと 10 分ごとに通知（ログに「知らせました」）。60 分で「画面に残っているダイアログで『インストール』を押してから…」で失敗し、Hermes は飛ばす
- Homebrew → Git → Hermes: パスワード画面（osascript の askpass）が1回出て、入れると Homebrew が `softwareupdate` で CLT を入れた（約 1 分、ダイアログなし）。
  Git は「入っています（2.54.0）。飛ばします」、Hermes 0.22.2 も入った（約 1 分）。開いたままだった古い CLT のダイアログは、CLT が入ると自分で閉じた
- Homebrew 7 のインストーラは `/etc/paths.d/homebrew` を置くので、新しいシェルで `/opt/homebrew/bin` が既に見える。shellenv の手順は「PATH に入っています」で何も書かない
- パスワード画面を放っておいても、sudo の 5 分の制限には掛からない（7 分後もそのまま待っていた）。60 分でアプリが止めて失敗にし、Git は CLT のダイアログに切り替わった
- ログイン画面: Hermes の「確認できません」は外した（`hermes model` はモデルの選択で、ログインではない）

## 確認済み（2026-10-15, macOS arm64, AI エージェントとアプリの追加）
- 仮のホームへの実インストール: Pi 1.2.0（Node.js 24.22.0 も）/ OpenCode 1.19.0 / Grok Build 1.0.52 / Orca 1.4.226 / T3 Code 0.0.45（約 1 分）、
  Hermes Agent 0.22.1（約 6 分、`.hermes` 1.9 GB と uv の Python 72 MB）。2回目は全部飛ばす。新しいシェルで `pi` `opencode` `grok` `orca` `hermes` が見える
- Grok: シェル設定を書かず、`~/.local/bin` には `grok` だけ（`agent` は貼られない）。`~/.config/fish/completions/grok.fish` は作られる
- Hermes: 実行前に `.zprofile` を退避。`.zprofile` は ai-setup のブロックがあるので書き換えられず、`.zshrc` が新しく作られて
  `~/.local/bin` を PATH に足す3行が入る（元が無いので退避するものも無い）
- 画面: AI エージェントを全部外すと「AI エージェントのどれか1つを選んでください。」で進めない。Pi に印を付けると Node.js にも印が付く。
  ログイン画面で Grok は「未ログイン」（`~/.grok/auth.json` で判定）、Hermes は「確認できません」。完了画面に Orca・T3 Code のボタンと4つのコマンド

## 確認済み（2026-10-03, macOS arm64, M2 の実機）
- ログイン: 仮のホームで claude / codex / gh / composio の「ログインする」→ ターミナルとブラウザ → 数秒で「ログイン済み」。
  本物のキーチェーン（Claude Code・Codex Auth・gh:github.com）は書き換わらない（仮のホームではどれもファイルに保存される）
- Rosetta: x64 版の 0.1.0 を動かすと、画面は「macOS arm64」になり、Claude Code・Codex・Paseo は arm64 版が入る。
  「更新する」で arm64 版の 0.2.0 に入れ替わる（x64 の zip ではなく arm64 の zip を取る）

## 仮のホーム（AISETUP_HOME）で試すときの注意
- キーチェーンを使うツール（gh など）は、HOME が変わるとキーチェーンを見つけられず「キーチェーンが見つかりません」のダイアログを出す。
  **「キャンセル」を押す**（「デフォルトに戻す」は押さない）。gh はファイル（`<仮のホーム>/.config/gh/hosts.yml`）に保存して続ける
- 仮のホームでログインした資格情報は本物なので、終わったら仮のホームで各ツールのログアウトを流してから消す
- 本物のホームを指す環境変数（`COMPOSIO_INSTALL_DIR` など）は子プロセスに渡さない（`env.js` の `childEnv`）。
  以前は渡していて、本物の `~/.composio` に入ってしまった

## 確認済み（2026-10-03, macOS arm64, アプリ自身の更新）
- 公開した v0.1.0 を dmg から /Applications に入れ、v0.2.0 を公開 →「更新を確認」で帯が出る →「更新する」
  → 120.8 MB を取得し、sha512・署名と公証・チーム ID（UN2QQ4V555）を確かめて入れ替え、開き直して v0.2.0 になった（約 15 秒）。
  開き直したあとの「更新を確認」は「最新です」、一時フォルダも残らない

## 確認済み（2026-10-03, macOS arm64, M2）
- 仮のホームへの実インストール: gh 2.102.0 / Node.js 24.21.0 / pnpm 12.8.1 / Tailscale 1.102.4 / Composio 0.4.2（約 25 秒）、2回目は全部飛ばす
- ログイン画面: 仮のホームで、入っていないもの・未ログインのものがそう表示される（ログインそのものは未確認）

## 確認済み（2026-10-02, macOS arm64）
- 仮のホームへの実インストール: Claude Code 2.1.287 / Codex 0.160.0 / Paseo 0.10.3（約 47 秒）、2回目は全部飛ばす
- GUI（dry-run と実インストール）で、ようこそ → 完了まで
- `pnpm run dist` の .app がカタログを読み、判定できる

## 未確認（実機待ち）
- Windows の Grok（`install.ps1`）・Orca・T3 Code（`/S` で per-user に入るか、入る場所 `%LOCALAPPDATA%\Programs\orca` / `t3code`）
- Pi・OpenCode・Grok・Hermes・Orca・T3 Code の Intel Mac
- アプリ自身の更新: 本物の Intel Mac、標準ユーザー、Windows の `/S --updated --force-run`
- 標準ユーザーで /Applications に書けないときの ~/Applications（標準ユーザーのアカウントで試す）
- Windows の全手順（PATH 設定・展開は未実装、M4）
- 標準ユーザーでの /Applications 書き込み不可 → ~/Applications へのフォールバック
- 標準ユーザーで Homebrew を選んだとき（sudo が使えず失敗 → Git は CLT のダイアログに切り替わるはず）、Intel Mac の Homebrew（`/usr/local`）
- パスワード画面のキャンセル、CLT のダイアログのキャンセル（「ダイアログが閉じられたため…」ですぐ失敗するはず）
