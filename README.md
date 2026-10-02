# AI Setup

English | [日本語](README.ja.md)

An app that installs the software for running AI agents locally — Claude Code, Codex, Paseo and more —
**with a few clicks, no terminal needed** (macOS / Windows).

The UI is Japanese only for now.

## What it installs

| Tier | Software | How |
|---|---|---|
| Required | Claude Code | Official installer (`claude.ai/install.sh` / `install.ps1`) |
| Required | Codex CLI | Official installer (`chatgpt.com/codex/install.sh` / `install.ps1`) |
| Required | Paseo | Official build from GitHub Releases (sha512 and code signature are verified) |
| Recommended | Git | Xcode Command Line Tools on Mac (installed through the OS dialog) |
| Recommended | GitHub CLI | zip from GitHub Releases (sha256 verified) |
| Recommended | Node.js | LTS from nodejs.org (sha256 verified) |
| Recommended | pnpm | via npm, into a place that survives Node.js upgrades |
| Optional | Tailscale | Official app from pkgs.tailscale.com (sha256 and code signature verified) |
| Optional | Composio | Official installer (not offered on Windows: no native build) |

After installing, the app guides you through signing in to Claude Code, Codex, GitHub CLI and Composio (a terminal and a browser open).
The recommended and optional tools are Mac only for now. Recommended settings are planned for a later milestone ([docs/PLAN.md](docs/PLAN.md)).

- Installs into places that need no administrator rights (`~/.local/bin`, `~/.local/share/ai-setup`, `/Applications` or `~/Applications`); only Git is installed by the OS
- Skips what is already installed. Running it again gives the same result
- Before adding to PATH in a shell profile (`~/.zprofile` etc.), the original file is backed up as `.bak-YYYYMMDD`
- Checks for a new version on every launch. When one is found, a bar appears at the top; "更新する" (Update) replaces the app and reopens it

## Development

```sh
pnpm install
pnpm start              # launch
pnpm run start:dry      # install nothing, only walk through the steps
pnpm test

pnpm run detect                                  # what is installed
pnpm run plan -- --os win32 --arch arm64         # show the steps for another OS
AISETUP_HOME=/tmp/h node src/cli.js install      # really install into a throwaway home
```

## Distribution

```sh
pnpm run dist                                         # ad-hoc signed (for local testing)
pnpm run release                                      # Developer ID signed + notarized + draft GitHub release
gh release edit v<version> --draft=false               # publish after checking the draft
```

Pass the notarytool keychain profile name via `APPLE_KEYCHAIN_PROFILE` or `.notary-profile` at the repository root
(not committed; a single line with the name).

Installed copies learn about new versions from `latest-mac.yml` / `latest.yml` of the latest published release.
Bump `version` in `package.json` before releasing.

The Windows build is not code-signed, so SmartScreen warns on first launch
("More info" → "Run anyway"). It may not start on Windows 11 PCs with Smart App Control enabled.

## License

[MIT](LICENSE)
