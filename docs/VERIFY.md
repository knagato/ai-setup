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

## リリース前（実機）
- 新しい macOS ユーザー（標準ユーザー / 管理者ユーザー）で、dmg をブラウザから落として入れる
- 新しいターミナルで `claude --version` / `codex --version` / `paseo --version` が通る
- 既存の `~/.zprofile` が退避（`.bak-YYYYMMDD`）され、ai-setup ブロックが1つだけ入っている
- Windows: Windows Sandbox（x64）と ARM の VM。インストーラはブラウザ経由で落とし、SmartScreen が出るところから

## 確認済み（2026-10-02, macOS arm64）
- 仮のホームへの実インストール: Claude Code 2.1.287 / Codex 0.160.0 / Paseo 0.10.3（約 47 秒）、2回目は全部飛ばす
- GUI（dry-run と実インストール）で、ようこそ → 完了まで
- `pnpm run dist` の .app がカタログを読み、判定できる

## 未確認（実機待ち）
- Windows の全手順（PATH 設定・展開は未実装、M4）
- 標準ユーザーでの /Applications 書き込み不可 → ~/Applications へのフォールバック
