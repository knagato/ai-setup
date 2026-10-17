#!/bin/bash
# dist/ の dmg / zip / latest-mac.yml を、Forgejo（tailnet の中だけ・非公開）のリリースに上げる。
# ここで落として確かめ、問題なければ scripts/publish.sh で GitHub に公開する。
#
#   ./scripts/forgejo-release.sh     （release.sh が最後に呼ぶ。上げ直すときは単独でも使える）
#
# タグ v<version> を今のコミットに打って forgejo へ push し、リリースは「プレリリース」で作る。
# 同じ名前のファイルが既にあれば消してから上げ直す。
# 認証は git の資格情報（git credential fill）を使い、パスワードはコマンドラインに出さない。
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p 'require("./package.json").version')
tag="v$version"
host=forgejo.knatrix.com
api="https://$host/api/v1/repos/knagato/ai-setup"

assets=(dist/*.dmg dist/*.zip dist/latest-mac.yml)
for f in "${assets[@]}"; do [ -f "$f" ] || { echo "$f が無い（先に release.sh でビルドする）" >&2; exit 1; }; done
built=$(sed -nE 's/^version: *//p' dist/latest-mac.yml)
[ "$built" = "$version" ] || { echo "dist/ は $built のビルド（package.json は $version）" >&2; exit 1; }

pw=$(printf 'protocol=https\nhost=%s\n\n' "$host" | git credential fill 2>/dev/null | sed -n 's/^password=//p')
[ -n "$pw" ] || { echo "$host の資格情報が git に無い" >&2; exit 1; }
netrc=$(mktemp)
trap 'rm -f "$netrc"' EXIT
chmod 600 "$netrc"
printf 'machine %s login knagato password %s\n' "$host" "$pw" >"$netrc"
call() { curl -sS --fail-with-body --netrc-file "$netrc" "$@"; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }

# タグはビルドしたコミットに打つ。既にあればそれを使う（ビルドの後に別のコミットを足してから上げ直すとき）
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  [ "$(git rev-parse "$tag^{commit}")" = "$(git rev-parse HEAD)" ] ||
    echo "注意: $tag は $(git rev-parse --short "$tag^{commit}") に打ってある（今は $(git rev-parse --short HEAD)）。そのまま使う" >&2
else
  git tag "$tag" HEAD
fi
git push -q forgejo HEAD:main "$tag"

if release=$(call "$api/releases/tags/$tag" 2>/dev/null); then
  id=$(echo "$release" | json 'v.id')
else
  body="リリース前の確認用。dmg を落として入れて確かめ、問題なければ \`pnpm run release:publish\` で GitHub に公開する。"
  id=$(call -X POST -H 'Content-Type: application/json' "$api/releases" \
    -d "$(node -p 'JSON.stringify({tag_name: process.argv[1], name: `AI Setup ${process.argv[2]}`, body: process.argv[3], prerelease: true})' "$tag" "$version" "$body")" |
    json 'v.id')
fi

existing=$(call "$api/releases/$id/assets")
for f in "${assets[@]}"; do
  name=$(basename "$f")
  old=$(echo "$existing" | json "(v.find(a => a.name === '$name') || {}).id || ''")
  [ -n "$old" ] && call -X DELETE "$api/releases/$id/assets/$old" >/dev/null
  call -X POST -F "attachment=@$f" "$api/releases/$id/assets?name=$name" >/dev/null
  echo "上げた: $name"
done
echo "確かめる: https://$host/knagato/ai-setup/releases/tag/$tag"
echo "問題なければ GitHub に公開する: pnpm run release:publish"
