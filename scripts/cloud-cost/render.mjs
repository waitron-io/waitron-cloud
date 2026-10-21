import { createRequire } from 'node:module';
import { projectUsage } from './projection.mjs';
import { validateCalculatorData } from './calculator.mjs';

const fail = () => { throw Error('Invalid cloud cost calculator'); };
const need = value => { if (!value) fail(); };
const keys = (value, names) => need(value && Reflect.ownKeys(value).length === names.length && names.every(name => Object.hasOwn(value, name)));
function json(value, ancestors = new Set(), budget = { left: 100000 }) {
  need(--budget.left >= 0 && ancestors.size < 24);
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') { need(Number.isFinite(value)); return; }
  need(value && typeof value === 'object' && !ancestors.has(value));
  const array = Array.isArray(value), names = Reflect.ownKeys(value);
  need(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype));
  if (array) need(value.length <= 10000 && names.length === value.length + 1
    && names.every(name => name === 'length' || typeof name === 'string' && /^(0|[1-9][0-9]*)$/.test(name) && Number(name) < value.length));
  ancestors.add(value);
  for (const name of names) { const d = Object.getOwnPropertyDescriptor(value, name); need(typeof name === 'string' && Object.hasOwn(d, 'value')); json(d.value, ancestors, budget); }
  ancestors.delete(value);
}
export function prepareCalculatorData(input) {
  try {
    json(input); keys(input, ['prices', 'inventory', 'samples', 'settings']);
    keys(input.prices, ['schemaVersion', 'regions', 'records', 'sources', 'terms', 'unavailable', 'gaps', 'external', 'accounting', 'pricingPages']);
    keys(input.inventory, ['schemaVersion', 'checkedAt', 'cloudRevision', 'defaultRegion', 'comparisonRegion', 'scope', 'runtimeRoles',
      'scenarios', 'rows', 'sources', 'completeTotalsAvailable']);
    const projection = projectUsage({ samples: input.samples, ...input.settings });
    const { stream, browser, archive } = projection.sources;
    const get = id => stream.inputs.find(row => row.id === id).value;
    return validateCalculatorData({ schemaVersion: 1, prices: input.prices.records,
      inventory: input.inventory.rows.map(({ id, inclusion }) => ({ id, inclusion })),
      basis: { sales: get('successful-sales'), databaseBytes: get('database-bytes'), growthBytes: get('database-growth-bytes'),
        archiveBytes: archive.replay.archive.capturedBytes, ownerBytesOut: browser.measurement.snapshot.producer.bytesFromGateway,
        idleSeconds: projection.streamTiming.phases.find(row => row.phase === 'idle').elapsedSeconds,
        requests: stream.accounting.requests,
        sources: { stream: { file: 'measurements.json', revision: stream.cloudRevision, observedAt: stream.window.endedAt },
          archive: { file: 'archive-replay.json', revision: archive.cloudRevision, observedAt: archive.endedAt },
          owner: { file: 'remote-owner-browser.json', revision: browser.source.cloudRevision,
            observedAt: new Date(browser.window.endedAt).toISOString() } } } });
  } catch { fail(); }
}

export async function renderCalculator(input) {
  try {
    json(input); keys(input, ['data']);
    const data = validateCalculatorData(input.data);
    const { build } = createRequire(new URL('../../packages/ui-smoke/package.json', import.meta.url))('esbuild');
    const result = await build({ entryPoints: [new URL('./calculator-browser.mjs', import.meta.url).pathname],
      bundle: true, platform: 'browser', format: 'iife', write: false, minify: true });
    const encoded = JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
      .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
    const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>Waitron Cloud cost model</title>
<style>
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:16px;color-scheme:light dark}
*{box-sizing:border-box}body{margin:0;background:#f4f5f8;color:#172233;--paper:#fff;--muted:#526176;--line:#d5dce7;--accent:#2358b1;--quiet:#e6edf9;--warn:#765119}
body[data-theme=dark]{background:#111824;color:#e7ecf4;--paper:#1b2535;--muted:#b4c1d4;--line:#3d4b61;--accent:#9fc2ff;--quiet:#263b59;--warn:#f2cd83}
a{color:var(--accent)}main{max-width:1160px;padding:32px 28px 56px;margin:auto}header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:40px}
.brand{font-weight:750;letter-spacing:.02em}.tools{display:flex;gap:12px}.tools label{font-size:.78rem;color:var(--muted)}.tools select{display:block;margin-top:4px}
h1{font-size:clamp(2rem,5vw,3.4rem);letter-spacing:-.045em;line-height:1.06;max-width:750px;margin:0 0 18px}h2{font-size:1.25rem;margin:0 0 16px}p{line-height:1.6;max-width:850px}.lede{font-size:1.08rem;color:var(--muted)}
.tag{display:inline-block;border:1px solid var(--line);border-radius:30px;font-size:.78rem;padding:6px 10px;margin:0 6px 8px 0;color:var(--muted)}
.panel{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:24px;margin-top:24px}.controls{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}.controls.advanced{grid-template-columns:repeat(3,minmax(0,1fr));margin-top:20px}
label{display:block;font-size:.9rem;font-weight:550}input,select,button{font:inherit;color:inherit;background:var(--paper);border:1px solid var(--line);border-radius:7px;padding:9px;max-width:100%}.controls input,.controls select{width:100%;margin-top:8px}input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px}input:invalid{border-color:#b94432}
small,.muted{color:var(--muted);line-height:1.6}small{display:block;font-size:.78rem}details{margin-top:22px}summary{font-weight:650;cursor:pointer;line-height:1.5}#error{color:var(--warn);font-weight:600}#error:empty{display:none}
.status{border-left:4px solid var(--warn);padding:12px 16px;margin:24px 0;color:var(--warn);background:var(--paper)}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th{text-align:left;color:var(--muted);font-size:.78rem;font-weight:600}th,td{padding:15px 9px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}td:not(:first-child),th:not(:first-child){text-align:right}td strong{color:var(--accent)}.bars{display:flex;height:5px;border-radius:3px;overflow:hidden;background:var(--quiet);margin-top:8px}.bars span:first-child{background:var(--accent)}.bars span:last-child{background:#7394ad}.legend{display:flex;gap:18px;font-size:.78rem;color:var(--muted)}.legend i{display:inline-block;width:9px;height:9px;background:var(--accent);margin-right:5px}.legend span:last-child i{background:#7394ad}
.columns{display:grid;grid-template-columns:1fr 1fr;gap:24px}.columns p{font-size:.9rem}.gap-list{columns:2;line-height:1.6;padding-left:20px}.gap-list li{break-inside:avoid;padding:5px 0}.source-list{font-size:.8rem;line-height:1.6;padding-left:20px}.source-list li{margin:10px 0;overflow-wrap:anywhere}#inventory{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:16px}.inventory-row{padding:12px;border:1px solid var(--line);border-radius:8px;font-size:.85rem;overflow-wrap:anywhere}.inventory-row small{margin-top:4px}footer{margin-top:32px;color:var(--muted);font-size:.8rem;line-height:1.7}
@media(max-width:760px){main{padding:20px 16px 36px}header{align-items:flex-start;margin-bottom:30px;gap:12px}.tools{gap:8px}.panel{padding:18px}.controls{grid-template-columns:1fr 1fr}.controls.advanced{grid-template-columns:1fr 1fr}.columns{grid-template-columns:1fr}.gap-list{columns:1}#inventory{grid-template-columns:1fr 1fr}#results thead{display:none}#results table,#results tbody{display:block}#results tr{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--line);padding:16px 0;gap:14px}#results td{display:block;border:0;padding:0;text-align:left;font-size:1rem}#results td:before{content:attr(data-label);display:block;font-size:.72rem;color:var(--muted);margin-bottom:4px}#results td:first-child{grid-column:1/-1;font-weight:700;font-size:1.15rem}#results td:first-child:before{display:inline;margin-right:8px}.source-list{padding-left:16px}}
@media(max-width:410px){.brand{font-size:.9rem}.tools select{font-size:.8rem;padding:7px}.controls.advanced{grid-template-columns:1fr}h1{max-width:340px}}
</style></head><body><main>
<header><div class="brand">WAITRON / CLOUD</div><div class="tools"><label><span id="language-label">Language</span><select id="language"><option value="en">English</option><option value="es">Español</option></select></label><label><span id="theme-label">Theme</span><select id="theme"><option value="light">Light</option><option value="dark">Dark</option></select></label></div></header>
<h1></h1><p class="lede" id="intro"></p><div id="tags"></div>
<section class="panel"><h2 id="assumption-heading"></h2><div class="controls" id="primary"></div><details id="advanced"><summary id="advanced-label"></summary><p class="muted" id="advanced-note"></p><div class="controls advanced" id="secondary"></div></details><p role="alert" id="error"></p></section>
<div role="status" class="status" id="status"></div><section class="panel" id="results"></section>
<section class="columns"><div class="panel" id="storage"></div><div class="panel" id="trial"></div></section>
<section class="panel"><h2 id="evidence-heading"></h2><p id="evidence-note"></p><div id="evidence"></div><details><summary id="gaps-label"></summary><ul class="gap-list" id="gaps"></ul></details><details><summary id="inventory-label"></summary><div id="inventory"></div></details><details><summary id="sources-label"></summary><ol class="source-list" id="sources"></ol></details></section><footer id="footer"></footer>
</main><script id="cost-data" type="application/json">${encoded}</script><script>${script}</script></body></html>\n`;
  } catch { fail(); }
}
