#!/bin/bash
# Forgejo で確かめたリリースを、GitHub（公開）に出す。配った AI Setup は GitHub の latest-mac.yml を見て更新するので、
# ここを流した時点で利用者に新しい版が届く。
#
#   ./scripts/publish.sh     （pnpm run release:publish）
#
# 確かめたものと同じものを出すため、dist/ のファイルが Forgejo のリリースにあるものと同じかを sha256 で比べてから上げる。
# コード（main とタグ）も、このとき GitHub に push する。
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p 'require("./package.json").version')
tag="v$version"
host=forgejo.knatrix.com
api="https://$host/api/v1/repos/knagato/ai-setup"
assets=(dist/*.dmg dist/*.zip dist/latest-mac.yml)

git rev-parse -q --verify "refs/tags/$tag" >/dev/null || { echo "$tag が無い（先に release.sh）" >&2; exit 1; }
git merge-base --is-ancestor "$tag" main || { echo "$tag のコミットが main に無い" >&2; exit 1; }

pw=$(printf 'protocol=https\nhost=%s\n\n' "$host" | git credential fill 2>/dev/null | sed -n 's/^password=//p')
[ -n "$pw" ] || { echo "$host の資格情報が git に無い" >&2; exit 1; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
printf 'machine %s login knagato password %s\n' "$host" "$pw" >"$work/netrc"
call() { curl -sS --fail-with-body --netrc-file "$work/netrc" "$@"; }

release=$(call "$api/releases/tags/$tag") || { echo "Forgejo に $tag のリリースが無い（先に forgejo-release.sh）" >&2; exit 1; }
echo "$release" >"$work/release.json"
for f in "${assets[@]}"; do
  name=$(basename "$f")
  url=$(node -e 'const r=require(process.argv[1]); console.log((r.assets.find(a => a.name === process.argv[2]) || {}).browser_download_url || "")' "$work/release.json" "$name")
  [ -n "$url" ] || { echo "Forgejo の $tag に $name が無い" >&2; exit 1; }
  call -L -o "$work/$name" "$url"
  [ "$(shasum -a 256 <"$f")" = "$(shasum -a 256 <"$work/$name")" ] || { echo "$name が Forgejo のものと違う（ビルドし直した？）" >&2; exit 1; }
  rm -f "$work/$name"
  echo "同じ: $name"
done

git push -q origin main "$tag"
if gh release view "$tag" >/dev/null 2>&1; then
  gh release upload "$tag" "${assets[@]}" --clobber
  gh release edit "$tag" --draft=false --prerelease=false --latest
else
  gh release create "$tag" "${assets[@]}" --verify-tag --title "AI Setup $version" --generate-notes --latest
fi
echo "公開した: https://github.com/knagato/ai-setup/releases/tag/$tag"
