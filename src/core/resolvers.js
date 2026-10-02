// 入れる版の解決。実行時に最新を調べ、調べられなければカタログの fallback（固定版）を使う。
// release を持たない strategy（公式スクリプト）は、版の選択をスクリプトに任せるので null を返す。

const { isAllowedUrl } = require("./download");

// electron-updater の latest-mac.yml / latest.yml。必要な形（version と files[]）だけ読む
function parseUpdaterYaml(text) {
  const out = { files: [] };
  const unquote = (s) => s.trim().replace(/^['"]|['"]$/g, "");
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    let m;
    if ((m = line.match(/^version:\s*(.+)$/))) {
      out.version = unquote(m[1]);
      cur = null;
    } else if ((m = line.match(/^\s+-\s+url:\s*(.+)$/))) {
      cur = { url: unquote(m[1]) };
      out.files.push(cur);
    } else if (cur && (m = line.match(/^\s+(sha512|size):\s*(.+)$/))) {
      cur[m[1]] = m[1] === "size" ? Number(m[2]) : unquote(m[2]);
    } else if (/^\S/.test(line)) {
      cur = null;
    }
  }
  return out;
}

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

function electronUpdaterRelease(release, ctx, version, sha512, size) {
  const file = fill(release.file, { version, arch: ctx.arch });
  return {
    version,
    url: `https://github.com/${release.repo}/releases/download/v${version}/${file}`,
    hash: { algo: "sha512", digest: sha512, encoding: "base64" },
    size,
  };
}

// sha256 で確かめる配布物。release.url / release.checksums は {version} と {arch} を埋めるテンプレート。
// {arch} は release.archMap で配布元の呼び方に直す（gh は x64 を amd64 と呼ぶ）
function sha256Release(release, ctx, version, digest) {
  const arch = release.archMap?.[ctx.arch] ?? ctx.arch;
  return { version, arch, url: fill(release.url, { version, arch }), hash: { algo: "sha256", digest, encoding: "hex" } };
}

// SHASUMS256.txt のような「<hex>  <name>」の並び、または hex だけのファイルから、url のファイルのハッシュを読む
function findSha256(text, url) {
  const name = url.split("/").pop();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 1 && /^[0-9a-f]{64}$/i.test(lines[0].trim())) return lines[0].trim().toLowerCase();
  for (const line of lines) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m && m[2] === name) return m[1].toLowerCase();
  }
  return null;
}

async function withSha256(release, ctx, version, { fetchText }) {
  const r = sha256Release(release, ctx, version, null);
  const sums = fill(release.checksums, { version, arch: r.arch });
  const digest = findSha256(await fetchText(sums), r.url);
  if (!digest) throw new Error(`${sums} に ${r.url.split("/").pop()} のハッシュがありません`);
  return { ...r, hash: { ...r.hash, digest } };
}

const RESOLVERS = {
  async electronUpdater(release, ctx, { fetchText }) {
    const url = `https://github.com/${release.repo}/releases/latest/download/${release.manifest}`;
    const manifest = parseUpdaterYaml(await fetchText(url));
    if (!manifest.version) throw new Error(`${release.manifest} に version がありません`);
    const name = fill(release.file, { version: manifest.version, arch: ctx.arch });
    const file = manifest.files.find((f) => f.url === name);
    if (!file?.sha512) throw new Error(`${release.manifest} に ${name} がありません`);
    return electronUpdaterRelease(release, ctx, manifest.version, file.sha512, file.size);
  },
  // GitHub の releases/latest は最新のタグ（/releases/tag/v1.2.3）へ転送される
  async githubLatest(release, ctx, io) {
    const final = await io.finalUrl(`https://github.com/${release.repo}/releases/latest`);
    const version = final.match(/\/releases\/tag\/v?([^/?#]+)$/)?.[1];
    if (!version) throw new Error(`最新の版が分かりません（${final}）`);
    return withSha256(release, ctx, version, io);
  },
  // nodejs.org の一覧の先頭にある LTS
  async nodeLts(release, ctx, io) {
    const list = JSON.parse(await io.fetchText("https://nodejs.org/dist/index.json"));
    const lts = list.find((v) => v.lts);
    if (!lts) throw new Error("LTS の版が見つかりません");
    return withSha256(release, ctx, lts.version.replace(/^v/, ""), io);
  },
  // pkgs.tailscale.com の一覧（mac はユニバーサルの zip）
  async tailscaleStable(release, ctx, io) {
    const info = JSON.parse(await io.fetchText("https://pkgs.tailscale.com/stable/?mode=json"));
    if (!info.MacZipsVersion) throw new Error("Tailscale の版が分かりません");
    return withSha256(release, ctx, info.MacZipsVersion, io);
  },
};

function fallbackRelease(install, ctx) {
  const fb = install.fallback;
  if (!fb) return null;
  if (install.release.type === "electronUpdater") {
    const sha512 = fb.sha512?.[ctx.arch];
    return sha512 ? electronUpdaterRelease(install.release, ctx, fb.version, sha512) : null;
  }
  const sha256 = fb.sha256?.[ctx.arch];
  return sha256 ? sha256Release(install.release, ctx, fb.version, sha256) : null;
}

async function defaultFetchText(url) {
  if (!isAllowedUrl(url)) throw new Error(`許可していない取得元です: ${url}`);
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

// 転送をたどった先の URL（本文は読まない）
async function defaultFinalUrl(url) {
  if (!isAllowedUrl(url)) throw new Error(`許可していない取得元です: ${url}`);
  const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  if (!isAllowedUrl(res.url)) throw new Error(`許可していない取得元に転送されました: ${res.url}`);
  return res.url;
}

// 戻り値: { version, url, hash, size?, pinned?: true, resolveError? } または null
async function resolveRelease(install, ctx, { offline = false, fetchText = defaultFetchText, finalUrl = defaultFinalUrl } = {}) {
  if (!install.release) return null;
  if (!offline) {
    try {
      return await RESOLVERS[install.release.type](install.release, ctx, { fetchText, finalUrl });
    } catch (e) {
      const fb = fallbackRelease(install, ctx);
      if (fb) return { ...fb, pinned: true, resolveError: e.message };
      throw e;
    }
  }
  const fb = fallbackRelease(install, ctx);
  if (!fb) throw new Error("オフラインでは版を決められません（fallback がありません）");
  return { ...fb, pinned: true };
}

module.exports = { resolveRelease, parseUpdaterYaml, findSha256, RESOLVERS, fetchText: defaultFetchText };
