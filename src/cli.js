#!/usr/bin/env node
// Electron 無しで中身を確かめるための CLI。
//
//   node src/cli.js detect                          … 何が入っているか
//   node src/cli.js plan [--os win32] [--arch arm64] [--offline] [id…]
//                                                   … 実行する手順を表示（何もしない）
//   node src/cli.js install --dry-run [id…]         … 判定込みで、実行する手順を流す
//   AISETUP_HOME=/tmp/h node src/cli.js install id  … 仮のホームに実際に入れる

const { loadCatalog, validateCatalog, installOrder } = require("./core/catalog");
const { makeContext } = require("./core/platform");
const { probeEnv } = require("./core/env");
const { detectAll } = require("./core/detect");
const { resolveRelease } = require("./core/resolvers");
const { planItem, describeStep } = require("./core/plan");
const { installItems } = require("./core/installer");

function parseArgs(argv) {
  const opts = { ids: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--os") opts.os = argv[++i];
    else if (a === "--arch") opts.arch = argv[++i];
    else if (a === "--offline") opts.offline = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else opts.ids.push(a);
  }
  return opts;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);
  const items = loadCatalog();
  const errors = validateCatalog(items);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  const ids = opts.ids.length ? opts.ids : items.map((i) => i.id);

  if (command === "detect") {
    const ctx = makeContext();
    const envInfo = await probeEnv(ctx);
    for (const d of await detectAll(items, ctx, envInfo)) {
      console.log(`${d.id.padEnd(14)} ${d.state.padEnd(20)} ${d.version ?? ""} ${d.path ?? ""}`);
    }
  } else if (command === "plan") {
    const ctx = makeContext({ os: opts.os, arch: opts.arch });
    console.log(`# ${ctx.os} / ${ctx.arch} / ${ctx.home}`);
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const id of installOrder(items, ids)) {
      const item = byId.get(id);
      const p = item.platforms[ctx.os];
      if (!p) {
        console.log(`\n## ${item.name}: この OS には対応していません`);
        continue;
      }
      const release = await resolveRelease(p.install, ctx, { offline: opts.offline });
      const plan = planItem(item, ctx, release);
      const v = plan.version ? ` ${plan.version}${plan.pinned ? "（固定版）" : ""}` : "";
      console.log(`\n## ${item.name}${v}${plan.admin ? " [管理者]" : ""}`);
      for (const s of plan.steps) console.log(`- ${describeStep(s)}`);
    }
  } else if (command === "install") {
    const ctx = makeContext();
    const results = await installItems(ids, {
      items,
      ctx,
      dryRun: opts.dryRun,
      offline: opts.offline,
      onEvent: (e) => {
        if (e.type === "log") console.log(`[${e.id}] ${e.line}`);
        else if (e.type === "item" && e.status !== "running") {
          console.log(`[${e.id}] => ${e.status}${e.error ? `: ${e.error}` : ""}`);
        }
      },
    });
    if (Object.values(results).some((r) => r.status === "failed")) process.exit(1);
  } else {
    console.error("使い方: node src/cli.js detect | plan [--os O] [--arch A] [--offline] [id…] | install [--dry-run] [id…]");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
