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
- アプリ自身の更新: 本物の Intel Mac、標準ユーザー、Windows の `/S --updated --force-run`
- Xcode のコマンドライン・ツールが無い Mac での Git（このMacには Xcode が入っているので試せない）
- 標準ユーザーで /Applications に書けないときの ~/Applications（標準ユーザーのアカウントで試す）
- Windows の全手順（PATH 設定・展開は未実装、M4）
- 標準ユーザーでの /Applications 書き込み不可 → ~/Applications へのフォールバック
