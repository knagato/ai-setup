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
};

function fallbackRelease(install, ctx) {
  const fb = install.fallback;
  const sha512 = fb?.sha512?.[ctx.arch];
  if (!fb || !sha512) return null;
  if (install.release.type === "electronUpdater") return electronUpdaterRelease(install.release, ctx, fb.version, sha512);
  return null;
}

async function defaultFetchText(url) {
  if (!isAllowedUrl(url)) throw new Error(`許可していない取得元です: ${url}`);
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

// 戻り値: { version, url, hash, size?, pinned?: true, resolveError? } または null
async function resolveRelease(install, ctx, { offline = false, fetchText = defaultFetchText } = {}) {
  if (!install.release) return null;
  if (!offline) {
    try {
      return await RESOLVERS[install.release.type](install.release, ctx, { fetchText });
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

module.exports = { resolveRelease, parseUpdaterYaml, fetchText: defaultFetchText };
