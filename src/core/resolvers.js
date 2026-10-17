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

// Sparkle の appcast。<item> ごとに、本体の enclosure（差分の sparkle:deltas は除く）と版を読む。
// 版は enclosure の属性に書く配布元（Docker）と、子要素に書く配布元（OrbStack）がある
function parseAppcast(text) {
  const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
  const elem = (body, name) => body.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim();
  return [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, raw]) => {
    const body = raw.replace(/<sparkle:deltas>[\s\S]*?<\/sparkle:deltas>/g, "");
    const enc = body.match(/<enclosure\b[^>]*>/)?.[0] ?? "";
    const length = attr(enc, "length");
    return {
      channel: elem(body, "sparkle:channel") ?? null,
      version: attr(enc, "sparkle:shortVersionString") ?? elem(body, "sparkle:shortVersionString"),
      build: attr(enc, "sparkle:version") ?? elem(body, "sparkle:version"),
      url: attr(enc, "url"),
      length: length ? Number(length) : undefined,
      edSignature: attr(enc, "sparkle:edSignature"),
    };
  });
}

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

// release.file は文字列か、arch ごとの対応表（x64 だけ名前に arch が入らない配布元がある）
function updaterFile(release, ctx, version) {
  const template = typeof release.file === "string" ? release.file : release.file[ctx.arch];
  if (!template) throw new Error(`${ctx.arch} 向けのファイルがありません`);
  return fill(template, { version, arch: ctx.arch });
}

function electronUpdaterRelease(release, ctx, version, sha512, size) {
  const file = updaterFile(release, ctx, version);
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

// GitHub の releases/latest は最新のタグ（/releases/tag/v1.2.3）へ転送される
async function latestTag(release, io) {
  const final = await io.finalUrl(`https://github.com/${release.repo}/releases/latest`);
  const version = final.match(/\/releases\/tag\/v?([^/?#]+)$/)?.[1];
  if (!version) throw new Error(`最新の版が分かりません（${final}）`);
  return version;
}

// Sparkle で配られる mac アプリ（dmg）。照合は、配布元の sha256 の一覧（release.checksums）か、
// appcast に載った ed25519 の署名（release.edKey がアプリの公開鍵）で行う
function sparkleHash(release, signature, sha256) {
  return release.edKey
    ? { algo: "ed25519", publicKey: release.edKey, signature }
    : { algo: "sha256", digest: sha256, encoding: "hex" };
}

const RESOLVERS = {
  async electronUpdater(release, ctx, { fetchText }) {
    const url = `https://github.com/${release.repo}/releases/latest/download/${release.manifest}`;
    const manifest = parseUpdaterYaml(await fetchText(url));
    if (!manifest.version) throw new Error(`${release.manifest} に version がありません`);
    const name = updaterFile(release, ctx, manifest.version);
    const file = manifest.files.find((f) => f.url === name);
    if (!file?.sha512) throw new Error(`${release.manifest} に ${name} がありません`);
    return electronUpdaterRelease(release, ctx, manifest.version, file.sha512, file.size);
  },
  async githubLatest(release, ctx, io) {
    return withSha256(release, ctx, await latestTag(release, io), io);
  },
  // checksums のファイルを置いていないリリース。sha256 は GitHub の API が出すアセットの digest で照合する
  async githubDigest(release, ctx, io) {
    const version = await latestTag(release, io);
    const r = sha256Release(release, ctx, version, null);
    const name = r.url.split("/").pop();
    const info = JSON.parse(await io.fetchText(`https://api.github.com/repos/${release.repo}/releases/tags/v${version}`));
    const digest = info.assets?.find((a) => a.name === name)?.digest?.match(/^sha256:([0-9a-f]{64})$/)?.[1];
    if (!digest) throw new Error(`v${version} に ${name} の digest がありません`);
    return { ...r, hash: { ...r.hash, digest } };
  },
  async sparkle(release, ctx, io) {
    const arch = release.archMap?.[ctx.arch] ?? ctx.arch;
    const items = parseAppcast(await io.fetchText(fill(release.appcast, { arch })));
    const item = items.find((i) => !release.channel || i.channel === release.channel);
    if (!item?.url || !item.version) throw new Error("appcast に入れる版がありません");
    let sha256 = null;
    if (release.edKey) {
      if (!item.edSignature) throw new Error("appcast に署名がありません");
    } else {
      const sums = fill(release.checksums, { arch, version: item.version, build: item.build });
      sha256 = findSha256(await io.fetchText(sums), item.url);
      if (!sha256) throw new Error(`${sums} に ${item.url.split("/").pop()} のハッシュがありません`);
    }
    return { version: item.version, build: item.build, url: item.url, size: item.length, hash: sparkleHash(release, item.edSignature, sha256) };
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
  if (install.release.type === "sparkle") {
    const signature = fb.edSignature?.[ctx.arch];
    const sha256 = fb.sha256?.[ctx.arch];
    if (!(install.release.edKey ? signature : sha256)) return null;
    const arch = install.release.archMap?.[ctx.arch] ?? ctx.arch;
    return {
      version: fb.version,
      build: fb.build,
      url: fill(install.release.url, { arch, version: fb.version, build: fb.build }),
      size: fb.size?.[ctx.arch],
      hash: sparkleHash(install.release, signature, sha256),
    };
  }
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

module.exports = { resolveRelease, parseUpdaterYaml, parseAppcast, findSha256, RESOLVERS, fetchText: defaultFetchText };
