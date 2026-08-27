import type { VisualComparedCase, VisualComparisonReport } from "./visual-contract.js";

export function renderVisualReportHtml(report: VisualComparisonReport): string {
  const changed = report.summary.changedCases;
  const sourceState = report.sourceInputsChanged ? "Source 输入已变化" : "Source 输入一致";
  const toolState = report.toolInputsChanged ? "工具实现已变化" : "工具实现一致";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(report.beforeBatch)} → ${escapeHtml(report.afterBatch)} · Legma Visual Diff</title>
  <style>
    :root { color-scheme: dark; --bg: #151817; --panel: #202522; --panel-2: #292f2b; --line: #414943; --ink: #eef4f0; --muted: #a6b1aa; --accent: #5ed6ad; --warn: #f4bd61; --danger: #ff766f; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 Inter, "Microsoft YaHei", sans-serif; letter-spacing: 0; }
    header { position: sticky; z-index: 10; top: 0; border-bottom: 1px solid var(--line); background: rgba(21, 24, 23, .96); }
    .header-inner, main { width: min(1600px, calc(100% - 32px)); margin: 0 auto; }
    .header-inner { padding: 18px 0 14px; }
    h1 { margin: 0; font-size: 22px; font-weight: 680; }
    .subtitle { margin: 3px 0 0; color: var(--muted); }
    .summary { margin-top: 14px; display: grid; grid-template-columns: repeat(6, minmax(120px, 1fr)); gap: 1px; border: 1px solid var(--line); background: var(--line); }
    .metric { min-width: 0; padding: 9px 10px; background: var(--panel); }
    .metric strong { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
    .metric span { color: var(--muted); font-size: 11px; }
    .context { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 12px; }
    .context span { padding: 3px 7px; border: 1px solid var(--line); border-radius: 3px; background: var(--panel); }
    .context .changed { border-color: var(--warn); color: var(--warn); }
    .filters { margin-top: 12px; display: inline-flex; border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
    .filters button { min-height: 30px; border: 0; border-right: 1px solid var(--line); padding: 0 12px; background: var(--panel); color: var(--muted); cursor: pointer; }
    .filters button:last-child { border-right: 0; }
    .filters button[aria-pressed="true"] { background: var(--accent); color: #0d1914; }
    main { padding: 20px 0 48px; display: grid; gap: 18px; }
    article { min-width: 0; border-top: 3px solid var(--line); background: var(--panel); }
    article[data-status="changed"] { border-top-color: var(--warn); }
    article[data-status="exact-only"] { border-top-color: #72b7ff; }
    article[data-status="capture-failed"], article[data-status^="missing"] { border-top-color: var(--danger); }
    .case-head { padding: 12px 14px; border-bottom: 1px solid var(--line); display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; }
    h2 { margin: 0; font-size: 16px; }
    .case-head p { margin: 2px 0 0; color: var(--muted); font-size: 12px; }
    .status { padding: 3px 7px; border: 1px solid var(--line); border-radius: 3px; color: var(--muted); font-size: 11px; text-transform: uppercase; }
    [data-status="changed"] .status { border-color: var(--warn); color: var(--warn); }
    [data-status="exact-only"] .status { border-color: #72b7ff; color: #72b7ff; }
    [data-status="capture-failed"] .status, [data-status^="missing"] .status { border-color: var(--danger); color: var(--danger); }
    .case-metrics { padding: 8px 14px; border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 14px; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
    .case-metrics strong { color: var(--ink); font-weight: 600; }
    .images { padding: 12px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    figure { min-width: 0; margin: 0; }
    figcaption { margin-bottom: 5px; color: var(--muted); font-size: 11px; }
    img { width: 100%; max-height: 720px; border: 1px solid var(--line); background-color: #101211; background-image: linear-gradient(45deg, #1c211e 25%, transparent 25%), linear-gradient(-45deg, #1c211e 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1c211e 75%), linear-gradient(-45deg, transparent 75%, #1c211e 75%); background-position: 0 0, 0 8px, 8px -8px, -8px 0; background-size: 16px 16px; object-fit: contain; }
    .message { margin: 0; padding: 12px 14px; color: var(--danger); }
    details { margin: 0 14px 12px; color: var(--muted); font-size: 11px; }
    pre { max-height: 260px; overflow: auto; padding: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); white-space: pre-wrap; }
    @media (max-width: 980px) { .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } .images { grid-template-columns: 1fr; } .case-head { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header><div class="header-inner">
    <h1>${escapeHtml(report.beforeBatch)} → ${escapeHtml(report.afterBatch)}</h1>
    <p class="subtitle">Legma visual comparison · ${escapeHtml(report.createdAt)}</p>
    <div class="summary">
      ${metric("用例", report.summary.totalCases)}
      ${metric("显著差异", changed)}
      ${metric("细微差异", report.summary.exactOnlyCases)}
      ${metric("完全一致", report.summary.identicalCases)}
      ${metric("不完整", report.summary.incompleteCases)}
      ${metric("感知变化", formatPercent(report.summary.perceptualChangedRatio))}
    </div>
    <div class="context"><span class="${report.sourceInputsChanged ? "changed" : ""}">${sourceState}</span><span class="${report.toolInputsChanged ? "changed" : ""}">${toolState}</span><span>差异仅报告，不作为通过门禁</span></div>
    <div class="filters" role="group" aria-label="筛选用例">
      <button type="button" data-filter="all" aria-pressed="true">全部</button>
      <button type="button" data-filter="changed" aria-pressed="false">仅差异</button>
      <button type="button" data-filter="incomplete" aria-pressed="false">不完整</button>
    </div>
  </div></header>
  <main>${report.cases.map(renderCase).join("\n")}</main>
  <script>
    const buttons = [...document.querySelectorAll('[data-filter]')];
    const cases = [...document.querySelectorAll('article[data-status]')];
    for (const button of buttons) button.addEventListener('click', () => {
      const filter = button.dataset.filter;
      for (const item of buttons) item.setAttribute('aria-pressed', String(item === button));
      for (const item of cases) {
        const status = item.dataset.status;
        const visible = filter === 'all' || (filter === 'changed' && ['changed', 'exact-only'].includes(status)) || (filter === 'incomplete' && !['changed', 'exact-only', 'identical'].includes(status));
        item.hidden = !visible;
      }
    });
  </script>
</body>
</html>\n`;
}

function renderCase(entry: VisualComparedCase): string {
  const metrics = entry.metrics;
  const context = [
    entry.componentType && `Component ${entry.componentType}`,
    entry.stateId && `State ${entry.stateId}`,
    entry.workspace === "inspectorFixture" && "隔离 fixture",
  ]
    .filter(Boolean)
    .join(" · ");
  const imageFigures = [
    entry.beforeImage ? figure("Before", entry.beforeImage) : "",
    entry.afterImage ? figure("After", entry.afterImage) : "",
    entry.diffImage ? figure("Diff", entry.diffImage) : "",
  ]
    .filter(Boolean)
    .join("");
  const metricLine = metrics
    ? `<div class="case-metrics">
    <span>精确变化 <strong>${formatInteger(metrics.exactChangedPixels)}</strong> / ${formatPercent(metrics.exactChangedRatio)}</span>
    <span>感知变化 <strong>${formatInteger(metrics.perceptualChangedPixels)}</strong> / ${formatPercent(metrics.perceptualChangedRatio)}</span>
    <span>平均通道差 <strong>${metrics.meanAbsoluteChannelDelta.toFixed(3)}</strong></span>
    <span>RMS <strong>${metrics.rootMeanSquareChannelDelta.toFixed(3)}</strong></span>
    <span>最大通道差 <strong>${metrics.maxChannelDelta}</strong></span>
    <span>尺寸 <strong>${metrics.beforeWidth}×${metrics.beforeHeight} → ${metrics.afterWidth}×${metrics.afterHeight}</strong></span>
  </div>`
    : "";
  return `<article data-status="${entry.status}">
    <div class="case-head"><div><h2>${escapeHtml(entry.title)}</h2><p>${escapeHtml(entry.description)} · ${entry.viewport.width}×${entry.viewport.height} · ${escapeHtml(entry.target.label)}${context ? ` · ${escapeHtml(context)}` : ""}</p></div><span class="status">${escapeHtml(entry.status)}</span></div>
    ${metricLine}
    ${entry.message ? `<p class="message">${escapeHtml(entry.message)}</p>` : ""}
    ${imageFigures ? `<div class="images">${imageFigures}</div>` : ""}
    ${metrics ? `<details><summary>机器分析数据</summary><pre>${escapeHtml(JSON.stringify(metrics, null, 2))}</pre></details>` : ""}
  </article>`;
}

function metric(label: string, value: string | number): string {
  return `<div class="metric"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
}

function figure(label: string, source: string): string {
  return `<figure><figcaption>${escapeHtml(label)}</figcaption><a href="${escapeAttribute(source)}" target="_blank" rel="noreferrer"><img src="${escapeAttribute(source)}" alt="${escapeAttribute(label)}" loading="lazy"></a></figure>`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(value === 0 ? 2 : 4)}%`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
