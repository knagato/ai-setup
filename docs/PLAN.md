# ai-setup — 「ローカル AI 環境」GUI インストーラ

## Context
Claude / ChatGPT のデスクトップアプリを使っている場合、デフォルトの実行環境はクラウドにある。
そのため、ターミナル等の操作に慣れていないユーザが手元の PC に CLI ツールを入れる手段が乏しい。
このプロジェクトでは、ローカルの AI 環境（Claude Code・Codex・Paseo ほか）を
**クリックだけで入れられる Electron アプリ**を作る。対象は **Mac と Windows**。
ログインの案内と、推奨設定の配布（壊さない方式）まで面倒を見る。

## 決定事項
- 名前: `ai-setup`（仮称。`appId` は `com.knatrix.aisetup`）
- 構成: Electron + pnpm + electron-builder
  - プレーンな JS で、バンドラは使わない
  - preload では `contextBridge` を使い、`contextIsolation` と `sandbox` を有効にし、CSP を設定する
  - テストは `node --test` で書く
  - リリースは `scripts/release.sh` で Developer ID 署名と公証を行う
- 入れるもの
  | 区分 | 項目 |
  |---|---|
  | 必須 | Claude Code、Codex CLI、Paseo（アプリと `paseo` CLI のシム） |
  | 追加（既定でオン） | Git（Mac は Xcode CLT、Windows は Git for Windows）、gh、Node LTS、pnpm |
  | 任意 | Tailscale、Composio（**Windows ネイティブ版がないため、Windows では選べないようにする**） |
- 初期設定
  - ログインは**外部ターミナルを開いて**行う。node-pty は使わない（ネイティブ依存をゼロに保つ）
  - 推奨設定（CLAUDE.md / AGENTS.md / settings.json / スキル）を、**差分を見せてから**適用する
- 対象外: tailnet への自動参加、Homebrew と winget の利用

## アーキテクチャ（カタログ駆動。計画と実行を分ける）
`catalog/*.json`（データ）→ `core/resolvers.js`（最新版を解決し、失敗したら固定版を使う）
→ `core/plan.js`（純粋関数。item × OS × arch → `Step[]`）→ `core/runner.js`（spawn、ストリーム、中断、dry-run）

- カタログの各項目には `id / tier / dependsOn / platforms.{darwin,win32}.{detect,install,postInstall} / login` を持たせる。
  **ツールの追加はカタログ1件の追加で済む**ようにする
- strategy（`src/core/strategies/`）は Step[] を返すだけで、副作用を持たない

| strategy | 中身 | 使う項目 |
|---|---|---|
| `officialScript` | 公式インストールスクリプトを実行する（`.ps1` は BOM 付きで保存） | claude、codex、composio |
| `archiveBinary` | DL → sha256 を検証 → `~/.local/share/ai-setup/<id>/<ver>` に置き、current へリンクする | gh、node（実装済み） |
| `macAppZip` | zip を sha512 で検証 → codesign / spctl / TeamID を確認 → `/Applications` に入れる（書けなければ `~/Applications`） | Paseo |
| `macPkgAdmin` | `osascript … with administrator privileges`。失敗したら `open -W x.pkg` | （使わない。Tailscale は管理者権限の要らない zip 版のアプリを `macAppZip` で入れる） |
| `winInstaller` | サイレント引数で実行する。必要なときだけ `Start-Process -Verb RunAs` で UAC を通す | Paseo `/S`、Git、Tailscale msi |
| `xcodeClt` | `xcode-select --install` → `xcode-select -p` が通るまでポーリング | Mac の Git（実装済み） |
| `cliShim` | `~/.local/bin/paseo` の symlink（Windows は `paseo.cmd`） | Paseo CLI |
| `npmGlobal` | `npm i -g --prefix ~/.local/share/ai-setup/npm-global pnpm`（Node の版を上げても消えない。corepack は使わない） | pnpm（実装済み） |

主な公式の入手元:
| 項目 | 入手元 |
|---|---|
| Claude Code | `claude.ai/install.sh`、`install.ps1` |
| Codex | `chatgpt.com/codex/install.sh`、`install.ps1`（`CODEX_NON_INTERACTIVE=1`） |
| Paseo | GitHub `getpaseo/paseo` の `latest-mac.yml` / `latest.yml` |
| Tailscale | `pkgs.tailscale.com/stable/?mode=json` |
| Node | `nodejs.org/dist/index.json` |
| gh、Git for Windows | GitHub の `releases/latest` のリダイレクト先から版を読む |

## 権限・PATH・検出
- **権限**
  - 基本はユーザー領域に入れる（`~/.local`、`%LOCALAPPDATA%`）
  - 管理者権限が要るのは Mac の Tailscale と Xcode CLT、Windows の Tailscale と Git（per-user で失敗した場合）だけ。UI では該当項目にバッジを付ける
- **Mac の PATH**
  - `~/.zprofile`（bash なら `~/.bash_profile`）に `# >>> ai-setup >>>` ブロックを書く。何度実行しても同じ結果になるようにし、書く前に `.bak-YYYYMMDD` を作る
  - **PATH に足すのは `~/.local/bin` だけ**。ほかの場所にあるコマンドは `~/.local/bin` へ symlink を貼る
    （Homebrew の `codex` が PATH に無いときも `/opt/homebrew/bin` ごとは足さない。M2 の Node も `node`・`npm`・`npx` を symlink する）
- **Windows の PATH**
  - レジストリの HKCU に REG_EXPAND_SZ のまま書く。`setx` は使わない
  - `.local\bin` は `WindowsApps` より前に置く（古い Claude.exe に横取りされる問題への対策）
- **検出**
  - Finder から起動すると PATH が足りないので、`$SHELL -ilc` で得た PATH と既知のパスを合わせて検出する
  - 状態は `installed / installedNotOnPath / missing / unsupported` の4つ
  - Mac の Git は `xcode-select -p` で判定する（`git --version` を叩くと CLT のダイアログが出てしまうため）
- **実行時の安全策**
  - DL 元はドメインの許可リストで縛り、ハッシュを検証する
  - preload は任意のコマンドを渡せない高水準 API に限る

## 画面の流れ（日本語・1ウィンドウ）
ようこそ → 環境チェック → 選択 → インストール（項目ごとの進捗、ログ、再試行、中断）
→ ログイン → おすすめ設定 → 完了

- ログイン画面
  - claude / codex / gh / composio の4ボタンを置く
  - Mac は `.command` を `open -a Terminal` で開き、Windows は `powershell -NoExit` で開く
  - 3秒ごとに `claude auth status`、`codex login status`、`gh auth status`、`composio whoami` を叩いて完了を検知する
- 全画面に「サポート用にログをコピー」ボタンを置く（トークンは伏せる）

## 推奨設定の配布（壊さない）
- `assets/settings/` には、**汎用の雛形を新しく作る**（個人の環境に依存する設定は含めない）
- **settings.json**: 無いキーだけを足す。配列は和集合にする。主な中身は `language: japanese`、`autoUpdatesChannel: stable`、`permissions.deny`（`.env` と `~/.ssh`）
- **`~/.claude/CLAUDE.md` と `~/.codex/AGENTS.md`**: `<!-- ai-setup:begin v1 -->` ブロックを足す。ブロックが既にあれば置き換える
- **スキル**: `assets/skills/` に同梱する（実行時に外から取りに行かない）
  - 同梱するスキルは実装時に決める
  - 特定の環境に依存するもの、利用者の手元に特別な準備が要るものは入れない
- **退避先**
  - ファイルは `<file>.bak-YYYYMMDD` にする
  - スキルは `~/.claude/backups/ai-setup/YYYYMMDD/` にする（skills 配下に置くと二重に読み込まれるため）

## リポジトリ構成
```
ai-setup/  AGENTS.md(+CLAUDE.md symlink)  README.ja.md  package.json
  build/{icon.png, entitlements.mac.plist}  scripts/{release.sh, refresh-pins.mjs, vendor-skills.sh}
  catalog/*.json  assets/{settings,skills}/
  src/{main.js, preload.js, cli.js}  src/ui/{index.html,app.css,app.js}
  src/core/{catalog,platform,env,detect,resolvers,plan,runner,download,pathfix,login,settings,diff,log}.js
  src/core/strategies/*.js   tests/*.test.mjs   docs/VERIFY.md
```

`package.json` の scripts は以下の構成とする:
| script | 中身 |
|---|---|
| `start` | 起動する |
| `start:dry` | `--dry-run` で起動する |
| `plan` | `node src/cli.js plan --os win32 --arch arm64` のように、Mac 上で他 OS の計画を出す |
| `test` | テストを実行する |
| `dist` / `dist:win` | ビルドする |
| `release` | 署名・公証付きでリリースする |

パスはすべて `AISETUP_HOME` で差し替えられるようにし、テストでは一時 HOME を使う。

## マイルストーン
- **M1（Mac の中核）**: core、必須3項目、PATH の修正、検出、画面1〜4、dry-run、単体テスト、ad-hoc の `dist`
- **M2（追加項目とログイン）**: Git(CLT)、gh、node、pnpm、Tailscale、Composio、ログイン画面、ログのコピー（Mac は実装済み。Windows は M4）
- **M3（設定の配布）**: 雛形、ブロックのマージ、スキルの同梱と修正、差分 UI、退避
- **M4（Windows）**: `winInstaller`、レジストリの PATH、UTF-8 対策、`dist:win`（x64 と arm64）
- **M5（署名付きリリース）**: `release.sh` による公証、SmartScreen の手順を README に書く、新版の通知と自己更新（`selfupdate.js`、実装済み）、`refresh-pins`

## 検証
- **単体テスト**: catalog（スキーマ、依存の循環、URL の許可リスト）、plan（4つの OS × arch の Step[] を固定値と照合）、download（ローカル HTTP 相手のハッシュ不一致と中断）、pathfix と settings（一時 HOME で、何度実行しても同じ結果になるか、退避ができるか）
- **Mac**
  - 新しい**標準ユーザー**と**管理者ユーザー**のアカウントを作り、その上でインストールする（または tart の vanilla VM を使う）
  - 新しいターミナルで `claude --version`、`codex --version`、`paseo` が通ることを確かめる
  - 2回目の実行で何も変わらないこと、既存の rc / CLAUDE.md が退避・マージされることを確かめる
- **Windows**: Windows Sandbox（x64）と ARM VM で試す。アプリはブラウザ経由で DL し、SmartScreen が出るところから確認する
- **実機で要確認**
  - `codex login status` と `claude auth status` の出力の形
  - Paseo の NSIS インストーラが `/S` で per-user に入るか
  - Git for Windows の `/CURRENTUSER`
  - 標準ユーザーで Xcode CLT が入るか
- **リスク**: Windows 11 の Smart App Control は署名の無いアプリを止める。配布先の PC で問題になれば Azure Trusted Signing を検討する
