# AI Setup

[English](README.md) | 日本語

Claude Code・Codex・Paseo など、パソコンで AI エージェントを動かすためのソフトを、
**ターミナルを使わずにクリックだけで**入れるアプリです（macOS / Windows）。

## 入るもの

| 区分 | ソフト | 入れ方 |
|---|---|---|
| 必須 | Claude Code | 公式インストーラ（`claude.ai/install.sh` / `install.ps1`） |
| 必須 | Codex CLI | 公式インストーラ（`chatgpt.com/codex/install.sh` / `install.ps1`） |
| 必須 | Paseo | GitHub Releases の公式ビルド（sha512 と署名を確認） |
| おすすめ | Git | Mac は Xcode のコマンドライン・ツール（OS のダイアログで入れる） |
| おすすめ | GitHub CLI | GitHub Releases の zip（sha256 を確認） |
| おすすめ | Node.js | nodejs.org の LTS（sha256 を確認） |
| おすすめ | pnpm | npm で入れる（Node.js の版を上げても消えない場所に） |
| 任意 | Tailscale | pkgs.tailscale.com の公式アプリ（sha256 と署名を確認） |
| 任意 | Composio | 公式インストーラ（Windows はネイティブ版が無いので選べない） |

インストールのあと、Claude Code・Codex・GitHub CLI・Composio のログインを案内します（ターミナルとブラウザが開きます）。
おすすめ・任意のものの Windows 版は準備中です。おすすめ設定の配布も今後足します（[docs/PLAN.md](docs/PLAN.md)）。

- 管理者権限が要らない場所（`~/.local/bin`・`~/.local/share/ai-setup`・`/Applications` か `~/Applications`）に入れます（Git だけは OS が入れます）
- 入っているものは飛ばします。何度実行しても同じ結果になります
- シェル設定（`~/.zprofile` など）に PATH を足すときは、元のファイルを `.bak-YYYYMMDD` に退避します
- 起動するたびに新しいバージョンがないか調べます。あれば画面の上に出るので、「更新する」を押すと入れ替わって開き直します

## 開発

```sh
pnpm install
pnpm start              # 起動
pnpm run start:dry      # 何も入れず、実行する手順だけを流す
pnpm test

pnpm run detect                                  # 何が入っているか
pnpm run plan -- --os win32 --arch arm64         # 別の OS 向けの手順を見る
AISETUP_HOME=/tmp/h node src/cli.js install      # 仮のホームに実際に入れる
```

## 配布

```sh
pnpm run dist                                         # ad-hoc 署名（手元で試す用）
APPLE_KEYCHAIN_PROFILE=aisetup-notary pnpm run release # Developer ID 署名 + 公証 + GitHub Releases に下書き
gh release edit v<version> --draft=false               # 中身を確かめて公開する
```

配った AI Setup は、公開されたリリースの `latest-mac.yml` / `latest.yml` を見て新しい版を知ります。
新しい版を出すときは、先に `package.json` の `version` を上げてください。

Windows 版はコード署名をしていないため、初回起動時に SmartScreen の警告が出ます
（「詳細情報」→「実行」）。Windows 11 の Smart App Control が有効な PC では起動できないことがあります。

## ライセンス

[MIT](LICENSE)
