// 選んだ項目を依存順に入れる。項目ごとに「判定 → 版の解決 → 手順の組み立て → 実行 → 再判定」。
// 入っているものは飛ばし、PATH だけが通っていないものは後処理だけをやり直す。
// 進み具合は onEvent に流す:
//   { type: "item", id, status: "running" | "done" | "skipped" | "failed", detection?, error? }
//   { type: "log", id, line }   { type: "progress", id, received, total }

const { installOrder } = require("./catalog");
const { detectItem } = require("./detect");
const { resolveRelease } = require("./resolvers");
const { planItem } = require("./plan");
const { runSteps } = require("./runner");
const { probeEnv } = require("./env");

async function installItems(ids, { items, ctx, dryRun = false, offline = false, signal, onEvent = () => {} }) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const order = installOrder(items, ids);
  let envInfo = await probeEnv(ctx);
  const results = {};

  for (const id of order) {
    const item = byId.get(id);
    const log = (line) => onEvent({ type: "log", id, line });
    if (signal?.aborted) {
      results[id] = { status: "failed", error: "中断しました" };
      onEvent({ type: "item", id, ...results[id] });
      continue;
    }
    // 依存先が入らなかったら、この項目も入れない
    const failedDep = (item.dependsOn ?? []).find((d) => results[d]?.status === "failed");
    if (failedDep) {
      results[id] = { status: "failed", error: `${byId.get(failedDep).name} が入らなかったため飛ばしました` };
      onEvent({ type: "item", id, ...results[id] });
      continue;
    }

    onEvent({ type: "item", id, status: "running" });
    try {
      const before = await detectItem(item, ctx, envInfo);
      if (before.state === "unsupported") throw new Error(before.detail ?? "この OS には対応していません");
      if (before.state === "installed") {
        log(`入っています${before.version ? `（${before.version}）` : ""}。飛ばします`);
        results[id] = { status: "skipped", detection: before };
        onEvent({ type: "item", id, ...results[id] });
        continue;
      }
      const mode = before.state === "installedNotOnPath" ? "fixPath" : "install";
      if (mode === "fixPath") log("入っていますが、ターミナルから使えるように設定します");
      const release = mode === "install" ? await resolveRelease(item.platforms[ctx.os].install, ctx, { offline }) : null;
      if (release?.resolveError) log(`最新版を調べられなかったので ${release.version} を入れます（${release.resolveError}）`);
      else if (release) log(`版 ${release.version}`);
      const foundPath = before.path && !before.appPath ? before.path : null;
      const plan = planItem(item, ctx, release, { mode, foundPath });

      await runSteps(plan.steps, {
        ctx,
        envInfo,
        dryRun,
        signal,
        onLog: log,
        onProgress: (p) => onEvent({ type: "progress", id, ...p }),
        vars: { appPath: before.appPath ?? undefined },
      });

      envInfo = await probeEnv(ctx);
      const after = dryRun ? before : await detectItem(item, ctx, envInfo);
      if (!dryRun && after.state !== "installed") {
        throw new Error(
          after.state === "installedNotOnPath"
            ? "入りましたが、ターミナルから見つかりません（PATH の設定を確認してください）"
            : "インストーラは終わりましたが、入ったことを確認できませんでした",
        );
      }
      results[id] = { status: "done", detection: after };
    } catch (e) {
      for (const line of e.tail ?? []) log(`  ${line}`);
      results[id] = { status: "failed", error: e.message };
    }
    onEvent({ type: "item", id, ...results[id] });
  }
  return results;
}

module.exports = { installItems };
