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

Additional tools (Git, gh, Node.js, pnpm), optional ones (Tailscale, Composio), sign-in guidance and
recommended settings are planned for later milestones ([docs/PLAN.md](docs/PLAN.md)).

- Installs into places that need no administrator rights (`~/.local/bin`, `/Applications` or `~/Applications`)
- Skips what is already installed. Running it again gives the same result
- Before adding to PATH in a shell profile (`~/.zprofile` etc.), the original file is backed up as `.bak-YYYYMMDD`

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
APPLE_KEYCHAIN_PROFILE=aisetup-notary pnpm run release # Developer ID signed + notarized
```

The Windows build is not code-signed, so SmartScreen warns on first launch
("More info" → "Run anyway"). It may not start on Windows 11 PCs with Smart App Control enabled.

## License

[MIT](LICENSE)
