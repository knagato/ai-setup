// ダウンロードと検証。取ってよいのは公式の配布元（ALLOWED_HOSTS）だけで、
// リダイレクトの行き先も確かめる。ハッシュが分かっているものは、書きながら計算して照合する。

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ALLOWED_HOSTS = new Set([
  "claude.ai",
  "downloads.claude.ai",
  "chatgpt.com",
  "releases.openai.com",
  "github.com",
  "nodejs.org",
  "pkgs.tailscale.com",
  "composio.dev",
  "get.pnpm.io",
]);
const ALLOWED_SUFFIXES = [".githubusercontent.com"];

function isAllowedUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  return ALLOWED_HOSTS.has(u.hostname) || ALLOWED_SUFFIXES.some((s) => u.hostname.endsWith(s));
}

// hash: { algo: "sha256" | "sha512", digest, encoding: "hex" | "base64" }
async function download(url, dest, { hash, addBom = false, signal, onProgress, fetchImpl = fetch, allow = isAllowedUrl } = {}) {
  if (!allow(url)) throw new Error(`許可していない取得元です: ${url}`);
  const res = await fetchImpl(url, { redirect: "follow", signal });
  if (res.url && res.url !== url && !allow(res.url)) throw new Error(`許可していない取得元に転送されました: ${res.url}`);
  if (!res.ok) throw new Error(`ダウンロードに失敗しました（HTTP ${res.status}）: ${url}`);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const total = Number(res.headers.get("content-length")) || 0;
  const hasher = hash ? crypto.createHash(hash.algo) : null;
  const out = fs.createWriteStream(dest);
  let received = 0;
  let first = true;
  try {
    for await (const chunk of res.body) {
      let buf = Buffer.from(chunk);
      // PowerShell 5.1 は BOM の無いスクリプトを ANSI（日本語環境なら CP932）として読む
      if (first && addBom && !(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)) {
        out.write(Buffer.from([0xef, 0xbb, 0xbf]));
      }
      first = false;
      hasher?.update(buf);
      if (!out.write(buf)) await new Promise((r) => out.once("drain", r));
      received += buf.length;
      onProgress?.({ received, total });
    }
  } finally {
    await new Promise((r) => out.end(r));
  }

  if (hasher) {
    const actual = hasher.digest(hash.encoding ?? "hex");
    if (actual !== hash.digest) {
      fs.rmSync(dest, { force: true });
      throw new Error(`ダウンロードしたファイルのハッシュが一致しません（${hash.algo}）: ${url}`);
    }
  }
  return { bytes: received };
}

module.exports = { download, isAllowedUrl, ALLOWED_HOSTS };
