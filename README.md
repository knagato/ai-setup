# AI Setup

English | [日本語](README.ja.md)

An app that installs the software for running AI agents locally — Claude Code, Codex, Paseo and more —
**with a few clicks, no terminal needed** (macOS / Windows).

The UI is Japanese only for now.

## What it installs

Tools are grouped by kind, and you choose what to install. Nothing is mandatory:
recommended tools are pre-selected, optional ones are not.
For the AI agents, **any one** of them is enough to continue.

| Group | Software | Tier | How |
|---|---|---|---|
| AI agents (pick at least one) | Claude Code | Recommended | Official installer (`claude.ai/install.sh` / `install.ps1`) |
| | Codex CLI | Recommended | Official installer (`chatgpt.com/codex/install.sh` / `install.ps1`) |
| | Pi | Optional | npm package `@earendil-works/pi-coding-agent` (installs Node.js too) |
| | OpenCode | Optional | zip from GitHub Releases (sha256 verified) |
| | Grok Build | Optional | Official installer (`x.ai/cli/install.sh` / `install.ps1`) |
| | Hermes Agent | Optional | Official installer (installs Git too; ~2 GB, ~10 min; shell profiles are backed up first because it edits them) |
| Desktop apps | Paseo | Recommended | Official build from GitHub Releases (sha512 and code signature are verified) |
| | Orca | Optional | Official build from GitHub Releases (sha512 and code signature verified) |
| | T3 Code | Optional | Official build from GitHub Releases (sha512 and code signature verified; alpha) |
| Developer tools | Homebrew | Recommended | Official installer (asks for the administrator password once; also installs the Xcode Command Line Tools for Git without the OS dialog; adds `brew shellenv` to the shell profile) |
| | Git | Recommended | Xcode Command Line Tools on Mac (comes with Homebrew; otherwise installed through the OS dialog) |
| | GitHub CLI | Recommended | zip from GitHub Releases (sha256 verified) |
| | Node.js | Recommended | LTS from nodejs.org (sha256 verified) |
| | pnpm | Recommended | via npm, into a place that survives Node.js upgrades |
| Containers | Docker Desktop | Optional | dmg from desktop.docker.com (sha256 and code signature verified; macOS 14+; paid for business use at larger companies) |
| | OrbStack | Optional | Official dmg (Sparkle ed25519 signature and code signature verified; macOS 14+; paid for business use) |
| Connectivity | Tailscale | Optional | Official app from pkgs.tailscale.com (sha256 and code signature verified) |
| | Composio | Optional | Official installer (not offered on Windows: no native build) |

After installing, the app guides you through signing in to Claude Code, Codex, Grok, Hermes, GitHub CLI and Composio (a terminal and a browser open).
On Windows, only Claude Code, Codex CLI, Grok Build, Paseo, Orca and T3 Code are available for now. Recommended settings are planned for a later milestone ([docs/PLAN.md](docs/PLAN.md)).

- Installs into places that need no administrator rights (`~/.local/bin`, `~/.local/share/ai-setup`, `/Applications` or `~/Applications`); Git is installed by the OS, and Homebrew into `/opt/homebrew` with the administrator password
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
