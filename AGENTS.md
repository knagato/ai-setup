# ai-setup

## What
- 用途: Claude Code・Codex・Paseo などのローカル AI 環境をクリックだけで入れる GUI インストーラ（macOS / Windows）
- スタック: Electron + プレーン JS（バンドラなし）+ electron-builder
- 主要ディレクトリ:
  - `catalog/*.json` … 入れるものの定義（1ツール = 1ファイル）。ツールを増やすときはここに足す
  - `src/core/` … Electron 非依存の中身。`plan.js` が Step[] を組み立て（純粋関数）、`runner.js` が実行する
  - `src/core/strategies/` … 入れ方（公式スクリプト / zip のアプリ / Windows インストーラ …）。Step[] を返すだけ
  - `src/main.js` `src/preload.js` `src/ui/` … 画面。preload は高水準 API だけを出す（任意のコマンドを渡せる口を作らない）

## How
- セットアップ: `pnpm install`（Electron の本体が落ちてこなければ `node node_modules/electron/install.js`）
- 開発実行: `pnpm start` / 何も入れずに手順だけ流す: `pnpm run start:dry`
- CLI で確認: `pnpm run detect` / `pnpm run plan -- --os win32 --arch arm64` / `node src/cli.js install --dry-run`
- 仮のホームに実際に入れる: `AISETUP_HOME=/tmp/h node src/cli.js install`（システム側の既存インストールと /Applications は見ない・触らない）
- テスト: `pnpm test`
- ビルド: `pnpm run dist`（ad-hoc 署名）/ リリース: `pnpm run release`（公証のプロファイル名は `APPLE_KEYCHAIN_PROFILE` か `.notary-profile`。エージェントの環境からも公証できる）
- 画面の動作確認は CDP: `--remote-debugging-port=19223`（127.0.0.1、確認時のみ）

## Conventions
- パッケージ操作・スクリプト実行は pnpm（npm は使わない）
- 依存は electron と electron-builder だけ。ネイティブモジュール（node-pty など）は入れない
- 取得元は `src/core/download.js` の ALLOWED_HOSTS に限る。ハッシュが分かるものは必ず照合する
- PATH に足すのは `~/.local/bin` の1か所だけ。個々のツールはそこへ symlink を貼る（`plan.js` の `hubDir`）。
  Homebrew の bin などを丸ごと PATH に足さない。Windows は symlink に権限が要るので、PATH（ユーザー）に足す
- 利用者のファイル（シェル設定・CLAUDE.md など）は、書き換える前に `<file>.bak-YYYYMMDD` に退避する。何度実行しても同じ結果になるようにする
- 画面の文言は日本語。非エンジニアが読む前提で、専門用語を避ける

## Notes
- Finder から起動したアプリの PATH は最小限。判定はログインシェル（`$SHELL -ilc`）の PATH を基準にする（`src/core/env.js`）
- macOS で `git --version` を叩くと、CLT が無い Mac では CLT のインストールダイアログが出てしまう。判定は `xcode-select -p` で（M2）
- Composio CLI は Windows ネイティブ版が無い（2026-10 時点）
- アプリ自身の更新は `src/core/selfupdate.js`。公開済みリリースの `latest-mac.yml` / `latest.yml`（electron-builder が書き出す）を読む。
  mac は zip を検証（sha512・署名・公証・チーム ID・bundle id・版）してから、アプリが終わるのを待って別プロセスで入れ替える。
  electron-updater は使わない（依存を増やさない）
- 計画とマイルストーン: `docs/PLAN.md`
