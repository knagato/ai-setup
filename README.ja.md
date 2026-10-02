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

追加（Git・gh・Node.js・pnpm）、任意（Tailscale・Composio）、ログインの案内、おすすめ設定の配布は
今後のマイルストーンで足します（[docs/PLAN.md](docs/PLAN.md)）。

- 管理者権限が要らない場所（`~/.local/bin`・`/Applications` か `~/Applications`）に入れます
- 入っているものは飛ばします。何度実行しても同じ結果になります
- シェル設定（`~/.zprofile` など）に PATH を足すときは、元のファイルを `.bak-YYYYMMDD` に退避します

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
APPLE_KEYCHAIN_PROFILE=aisetup-notary pnpm run release # Developer ID 署名 + 公証
```

Windows 版はコード署名をしていないため、初回起動時に SmartScreen の警告が出ます
（「詳細情報」→「実行」）。Windows 11 の Smart App Control が有効な PC では起動できないことがあります。

## ライセンス

[MIT](LICENSE)
