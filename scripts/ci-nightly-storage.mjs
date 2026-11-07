import {writeFileSync, appendFileSync, readFileSync, statSync, mkdtempSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const settingKeys = ['workload', 'sales', 'cadenceFactor', 'startupSeconds', 'idleSeconds', 'replayWindowSeconds', 'streamWindowSeconds'];
const runtimeKeys = ['waitron', 'litestream', 'node', 'platform', 'arch'];
const select = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const bounded = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

export function storageObservation(stream, settings, runtime) {
  const result = {status: 'unusable', bounds: null, gaps: ['storage-unavailable'],
    settings: select(settings, settingKeys), runtime: select(runtime, runtimeKeys)};
  const parts = [stream?.storage, stream?.retainedStorage];
  if (!parts.every(part => part?.status === 'measured'
    && (part.gaps === undefined || Array.isArray(part.gaps) && part.gaps.length === 0)
    && bounded(part.byteSeconds?.low) && bounded(part.byteSeconds?.high)
    && part.byteSeconds.low <= part.byteSeconds.high)) return result;
  // Publication-ineligible replays return before the existing stream accounting sum.
  const low = parts[0].byteSeconds.low + parts[1].byteSeconds.low;
  const high = parts[0].byteSeconds.high + parts[1].byteSeconds.high;
  if (!bounded(low) || !bounded(high)) return result;
  return {...result, status: 'measured', bounds: {low, high}, gaps: []};
}
export function exportStorageObservation({output, stream, settings, runtime, diagnostic}) {
  if (!output) return;
  try {
    writeFileSync(output, JSON.stringify(storageObservation(stream, settings, runtime)) + '\n');
  } catch {
    try {diagnostic?.('Cloud cost advisory: storage export unavailable.');} catch { /* Optional reporting cannot fail conformance. */ }
  }
}

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const pin = value => typeof value === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(value);
export function usableObservation(value) {
  return Boolean(exact(value, ['status', 'bounds', 'gaps', 'settings', 'runtime']) && value.status === 'measured'
    && Array.isArray(value.gaps) && value.gaps.length === 0
    && exact(value.bounds, ['low', 'high']) && bounded(value.bounds.low) && bounded(value.bounds.high)
    && value.bounds.high > 0 && value.bounds.low <= value.bounds.high
    && exact(value.settings, settingKeys) && pin(value.settings.workload)
    && settingKeys.slice(1).every(key => bounded(value.settings[key]) && value.settings[key] > 0)
    && exact(value.runtime, runtimeKeys) && /^[a-f0-9]{40}$/.test(value.runtime.waitron)
    && runtimeKeys.every(key => pin(value.runtime[key])));
}

export function storageChange(current, previous, threshold) {
  if (!usableObservation(current) || !usableObservation(previous)) return {status: 'unavailable', reason: 'measurement-unavailable'};
  if (!settingKeys.every(key => current.settings[key] === previous.settings[key])) return {status: 'unavailable', reason: 'workload-changed'};
  const increase = current.bounds.low / previous.bounds.high;
  const decrease = previous.bounds.low / current.bounds.high;
  if (!Number.isFinite(increase) || !Number.isFinite(decrease)) return {status: 'unavailable', reason: 'arithmetic-unavailable'};
  const change = increase > threshold ? {direction: 'increase', ratio: increase}
    : decrease > threshold ? {direction: 'decrease', ratio: decrease} : null;
  return {status: 'comparable', change, runtimeChanged: runtimeKeys.some(key => current.runtime[key] !== previous.runtime[key])};
}

const hour = 3600000;
const link = (repository, row) => `https://github.com/${repository}/actions/runs/${row.run.id}/attempts/${row.run.run_attempt}`;
const interval = value => `[${value.bounds.low}, ${value.bounds.high}] byte-seconds`;
export function buildStorageReport({repository, current, history, now, threshold, issues = []}) {
  const warnings = [];
  const lines = ['# Cloud cost advisory', '',
    'Generated storage only: one byte-second is one byte kept for one second. Requests, compute, transfer, archives and other service costs remain unknown.', ''];
  const warn = message => {warnings.push(message); lines.push(message, '');};
  if (issues.length) warn(`Cloud cost warning: evidence unavailable (${[...new Set(issues)].join(', ')}).`);
  const available = usableObservation(current.observation);
  lines.push(available ? `Current: ${link(repository, current)} ${interval(current.observation)}` : 'Current measurement unavailable.', '');
  if (current.run.event === 'pull_request') {
    lines.push('Rehearsal: current artifact/report only; this run does not enter main history.');
    if (!available) warn('Cloud cost warning: rehearsal storage measurement unavailable.');
    return {markdown: lines.join('\n') + '\n', warnings};
  }
  const candidates = history.filter(row => {
    const run = row.run, age = now - Date.parse(row.measuredAt);
    return run?.id !== current.run.id && Number.isSafeInteger(run?.id) && run.id > 0
      && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0 && /^[a-f0-9]{40}$/.test(run.head_sha)
      && run.head_repository?.full_name === repository && run.head_branch === 'main'
      && ['schedule', 'workflow_dispatch'].includes(run.event) && run.status === 'completed'
      && Number.isFinite(age) && age >= 0 && age <= 14 * 24 * hour;
  }).sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt));
  const usable = candidates.filter(row => usableObservation(row.observation));
  const previous = available ? usable.find(row => settingKeys.every(key => row.observation.settings[key] === current.observation.settings[key])) : usable[0];
  const skipped = candidates.filter(row => !usableObservation(row.observation)
    || available && !settingKeys.every(key => row.observation.settings[key] === current.observation.settings[key])).length;
  if (skipped) lines.push(`Skipped ${skipped} unusable or incomparable measurements.`, '');
  if (!available) warn('Cloud cost warning: current generated storage measurement unavailable.');
  if (!previous) warn('Cloud cost warning: No usable comparable baseline in retained main history.');
  else {
    lines.push(`Previous: ${link(repository, previous)} ${interval(previous.observation)}`, '');
    if (available) {
      const comparison = storageChange(current.observation, previous.observation, threshold);
      if (comparison.status !== 'comparable') warn(`Cloud cost warning: comparison unavailable (${comparison.reason}).`);
      else {
        if (comparison.runtimeChanged) lines.push('Runtime/native pins changed: ' + runtimeKeys
          .filter(key => current.observation.runtime[key] !== previous.observation.runtime[key])
          .map(key => `${key}: ${previous.observation.runtime[key]} → ${current.observation.runtime[key]}`).join('; '), '');
        if (comparison.change) warn(`Cloud cost warning: generated storage ${comparison.change.direction} at least ${comparison.change.ratio.toFixed(2)}×; ${link(repository, previous)} ${interval(previous.observation)} → ${link(repository, current)} ${interval(current.observation)}.`);
        else lines.push(`No change exceeds the conservative ${threshold}× threshold.`, '');
      }
    }
  }
  const latest = available ? current : usable[0];
  if (latest && now - Date.parse(latest.measuredAt) > 72 * hour)
    warn(`Cloud cost warning: last usable generated storage measurement is older than 72 hours; ${link(repository, latest)}.`);
  return {markdown: lines.join('\n') + '\n', warnings};
}

function main() {
  let report;
  try {
    const repository = process.env.GITHUB_REPOSITORY, id = Number(process.env.GITHUB_RUN_ID);
    const attempt = Number(process.env.GITHUB_RUN_ATTEMPT), now = Date.now(), deadline = now + 75000;
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository ?? '')
      || !Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(attempt) || attempt <= 0) throw Error();
    const gh = args => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw Error();
      return execFileSync('gh', args, {encoding: 'utf8', timeout: Math.min(15000, remaining),
        maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
    };
    const api = path => JSON.parse(gh(['api', `repos/${repository}/${path}`]));
    const issues = [];
    const load = run => {
      const row = {run, measuredAt: run.created_at, observation: null};
      let directory;
      try {
        const name = `nightly-storage-${run.id}-${run.run_attempt}`;
        const artifact = api(`actions/runs/${run.id}/artifacts?per_page=100`).artifacts
          .find(value => value.name === name && !value.expired);
        if (!artifact) throw Error();
        row.measuredAt = artifact.created_at;
        directory = mkdtempSync(join(tmpdir(), 'cloud-nightly-storage-'));
        gh(['run', 'download', String(run.id), '-R', repository, '-n', name, '-D', directory]);
        const file = join(directory, 'nightly-storage.json');
        if (!statSync(file).isFile() || statSync(file).size > 65536) throw Error();
        row.observation = JSON.parse(readFileSync(file, 'utf8'));
      } catch {issues.push('artifact-unavailable');}
      finally {if (directory) rmSync(directory, {recursive: true, force: true});}
      return row;
    };
    const run = api(`actions/runs/${id}`);
    if (run.id !== id || run.run_attempt !== attempt || run.head_repository?.full_name !== repository) throw Error();
    const current = load(run), history = [];
    if (run.event !== 'pull_request') {
      try {
        const since = encodeURIComponent('>=' + new Date(now - 14 * 24 * hour).toISOString());
        const runs = api(`actions/workflows/nightly.yml/runs?branch=main&per_page=100&created=${since}`).workflow_runs;
        for (const source of runs) {
          if (Date.now() >= deadline) {issues.push('history-unavailable'); break;}
          if (source.id !== id && source.head_repository?.full_name === repository && source.head_branch === 'main'
            && ['schedule', 'workflow_dispatch'].includes(source.event) && source.status === 'completed'
            && Date.parse(source.created_at) >= now - 14 * 24 * hour) history.push(load(source));
        }
      } catch {issues.push('history-unavailable');}
    }
    report = buildStorageReport({repository, current, history, now, threshold: 2, issues});
  } catch {
    report = {markdown: '# Cloud cost advisory\n\nCloud cost warning: advisory evidence unavailable.\n',
      warnings: ['Cloud cost warning: advisory evidence unavailable.']};
  }
  for (const warning of report.warnings) console.log('::warning::' + warning.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'));
  console.log(report.markdown);
  try {appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.markdown);} catch {console.log('::warning::Cloud cost advisory summary unavailable.');}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
