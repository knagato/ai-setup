# AI Setup

[English](README.md) | 日本語

Claude Code・Codex・Paseo など、パソコンで AI エージェントを動かすためのソフトを、
**ターミナルを使わずにクリックだけで**入れるアプリです（macOS / Windows）。

## 入るもの

種類ごとのグループに分けて並べ、どれを入れるかを選べます。外せないものはありません。
「おすすめ」は最初から選んであり、「任意」は自分で選びます。
AI エージェントは、**どれか1つ**があれば先に進めます。

| グループ | ソフト | 区分 | 入れ方 |
|---|---|---|---|
| AI エージェント（どれか1つ） | Claude Code | おすすめ | 公式インストーラ（`claude.ai/install.sh` / `install.ps1`） |
| | Codex CLI | おすすめ | 公式インストーラ（`chatgpt.com/codex/install.sh` / `install.ps1`） |
| | Pi | 任意 | npm の `@earendil-works/pi-coding-agent`（Node.js も入れる） |
| | OpenCode | 任意 | GitHub Releases の zip（sha256 を確認） |
| | Grok Build | 任意 | 公式インストーラ（`x.ai/cli/install.sh` / `install.ps1`） |
| | Hermes Agent | 任意 | 公式インストーラ（Git も入れる。約 2 GB・10 分ほど。シェル設定を書き換えるので先に退避する） |
| 画面から使うアプリ | Paseo | おすすめ | GitHub Releases の公式ビルド（sha512 と署名を確認） |
| | Orca | 任意 | GitHub Releases の公式ビルド（sha512 と署名を確認） |
| | T3 Code | 任意 | GitHub Releases の公式ビルド（sha512 と署名を確認。試作段階） |
| 開発の道具 | Homebrew | おすすめ | 公式インストーラ（管理者パスワードを1回聞く。Git に必要な Xcode のコマンドライン・ツールもダイアログなしで入る。PATH には `brew shellenv` を書く） |
| | Git | おすすめ | Mac は Xcode のコマンドライン・ツール（Homebrew を入れるならそれで入る。入れないときは OS のダイアログで入れる） |
| | GitHub CLI | おすすめ | GitHub Releases の zip（sha256 を確認） |
| | Node.js | おすすめ | nodejs.org の LTS（sha256 を確認） |
| | pnpm | おすすめ | npm で入れる（Node.js の版を上げても消えない場所に） |
| アプリを動かす箱（コンテナ） | Docker Desktop | 任意 | desktop.docker.com の dmg（sha256 と署名を確認。macOS 14 以降。大きな会社で仕事に使うなら有料） |
| | OrbStack | 任意 | 公式の dmg（Sparkle の ed25519 の署名と、アプリの署名を確認。macOS 14 以降。仕事で使うなら有料） |
| ほかとつなぐ道具 | Tailscale | 任意 | pkgs.tailscale.com の公式アプリ（sha256 と署名を確認） |
| | Composio | 任意 | 公式インストーラ（Windows はネイティブ版が無いので選べない） |

インストールのあと、Claude Code・Codex・Grok・Hermes・GitHub CLI・Composio のログインを案内します（ターミナルとブラウザが開きます）。
Windows で入れられるのは Claude Code・Codex CLI・Grok Build・Paseo・Orca・T3 Code で、ほかは準備中です。おすすめ設定の配布も今後足します（[docs/PLAN.md](docs/PLAN.md)）。

- 管理者権限が要らない場所（`~/.local/bin`・`~/.local/share/ai-setup`・`/Applications` か `~/Applications`）に入れます（Git は OS が、Homebrew は `/opt/homebrew` に管理者パスワードで入れます）
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
pnpm run release                                      # Developer ID 署名 + 公証 + GitHub Releases に下書き
gh release edit v<version> --draft=false               # 中身を確かめて公開する
```

公証に使うキーチェーンプロファイルの名前は、`APPLE_KEYCHAIN_PROFILE` か、リポジトリ直下の `.notary-profile`
（git に入れない。名前を1行だけ書く）で渡します。

配った AI Setup は、公開されたリリースの `latest-mac.yml` / `latest.yml` を見て新しい版を知ります。
新しい版を出すときは、先に `package.json` の `version` を上げてください。

Windows 版はコード署名をしていないため、初回起動時に SmartScreen の警告が出ます
（「詳細情報」→「実行」）。Windows 11 の Smart App Control が有効な PC では起動できないことがあります。

## ライセンス

[MIT](LICENSE)
