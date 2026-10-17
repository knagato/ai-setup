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
  "api.github.com",
  "nodejs.org",
  "pkgs.tailscale.com",
  "composio.dev",
  "get.pnpm.io",
  "x.ai",
  "desktop.docker.com",
  "cdn-updates.orbstack.dev",
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

// Sparkle（mac アプリの更新の仕組み）の署名。公開鍵は生の 32 バイトなので、SPKI の DER にして読む
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");
function verifyEd25519(file, publicKey, signature) {
  const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI, Buffer.from(publicKey, "base64")]), format: "der", type: "spki" });
  return crypto.verify(null, fs.readFileSync(file), key, Buffer.from(signature, "base64"));
}

// hash: { algo: "sha256" | "sha512", digest, encoding: "hex" | "base64" }
//     または { algo: "ed25519", publicKey, signature }（ファイル全体への署名。落とし終えてから確かめる）
async function download(url, dest, { hash, addBom = false, signal, onProgress, fetchImpl = fetch, allow = isAllowedUrl } = {}) {
  if (!allow(url)) throw new Error(`許可していない取得元です: ${url}`);
  const res = await fetchImpl(url, { redirect: "follow", signal });
  if (res.url && res.url !== url && !allow(res.url)) throw new Error(`許可していない取得元に転送されました: ${res.url}`);
  if (!res.ok) throw new Error(`ダウンロードに失敗しました（HTTP ${res.status}）: ${url}`);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const total = Number(res.headers.get("content-length")) || 0;
  const hasher = hash && hash.algo !== "ed25519" ? crypto.createHash(hash.algo) : null;
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

  if (hash?.algo === "ed25519" && !verifyEd25519(dest, hash.publicKey, hash.signature)) {
    fs.rmSync(dest, { force: true });
    throw new Error(`ダウンロードしたファイルの署名が一致しません（ed25519）: ${url}`);
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

module.exports = { download, isAllowedUrl, verifyEd25519, ALLOWED_HOSTS };
