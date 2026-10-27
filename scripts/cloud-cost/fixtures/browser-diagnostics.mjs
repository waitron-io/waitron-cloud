import {execFileSync} from 'node:child_process';

const phases = new Set(['options', 'meter', 'launch', 'context', 'login', 'dashboard',
  'reconnect', 'logout', 'close', 'accounting', 'snapshot']);

const steps = new Set(['reload', 'takings', 'overdue-empty', 'requests']);
const observations = [
  ['browserFailure', 'failure', /^(?:timeout|other)$/],
  ['browserSession', 'session', /^(?:accepted|refused|other|unseen)$/],
  ['browserPage', 'page', /^(?:error|clear)$/],
  ['browserRelay', 'relay', /^(?:none|socket-(?:client|upstream)-(?:reset|refused|pipe|other)|(?:timeout|incomplete)-(?:client|upstream)|empty-exchange|admission-refused|byte-limit|counter-mismatch|cancelled|window|listener-error|final-accounting)$/],
  ['browserTraffic', 'traffic', /^(?:none|(?:(?:before|reconnect):(?:outside|live|session|overview|overdue|api|asset|document|other):(?:started|ok|not-modified|redirect|refused|error|finished|size-failed|aborted|failed|pending):[1-9][0-9]{0,2})(?:,(?:before|reconnect):(?:outside|live|session|overview|overdue|api|asset|document|other):(?:started|ok|not-modified|redirect|refused|error|finished|size-failed|aborted|failed|pending):[1-9][0-9]{0,2}){0,197})$/],
];

// Diagnostic inspection must not replace the journey's original refusal.
function diagnosticValue(error, key) {
  try { return error && Object.getOwnPropertyDescriptor(error, key)?.value; }
  catch { return undefined; }
}

export function parseBrowserDiagnostics(stderr) {
  const browserPhase = /(?:^|\n)cost_browser_phase=(options|meter|launch|context|login|dashboard|reconnect|logout|close|accounting|snapshot)\n/.exec(stderr)?.[1];
  const browserStep = browserPhase === 'reconnect'
    ? /(?:^|\n)cost_browser_step=(reload|takings|overdue-empty|requests)\n/.exec(stderr)?.[1] : undefined;
  const parsed = {browserPhase, browserStep};
  if (browserPhase === 'reconnect') for (const [key, label, allowed] of observations) {
    const value = new RegExp('(?:^|\\n)cost_browser_' + label + '=([^\\n]*)\\n').exec(stderr)?.[1];
    if (typeof value === 'string' && allowed.test(value)) parsed[key] = value;
  }
  return parsed;
}

export async function withBrowserDiagnostics(run, report) {
  try { return await run(); }
  catch (error) {
    // Diagnostic output must preserve the journey's original refusal too.
    try {
      const phase = diagnosticValue(error, 'browserPhase');
      if (phases.has(phase)) report('cost_browser_phase=' + phase);
      const step = diagnosticValue(error, 'browserStep');
      if (phase === 'reconnect' && steps.has(step)) report('cost_browser_step=' + step);
      if (phase === 'reconnect') for (const [key, label, allowed] of observations) {
        const value = diagnosticValue(error, key);
        if (typeof value === 'string' && allowed.test(value)) report('cost_browser_' + label + '=' + value);
      }
    } catch {}
    throw error;
  }
}

export function runBrowserFixture(command, args, environment) {
  try { return execFileSync(command, args, { env: environment, encoding: 'utf8', timeout: 30000,
    maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (error) {
    const failure = Error('Generated local gateway fixture failed');
    // Fixed categories and counts retain command failure evidence without private arguments or output.
    failure.commandFailure = {
      command: command === 'docker' ? (args[0] === 'start' ? 'docker-start' : 'docker-other') : 'other',
      reason: ['EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EIO', 'ETIMEDOUT', 'ENOBUFS'].includes(error.code)
        ? error.code : 'command-exit',
      exitCode: Number.isSafeInteger(error.status) && error.status >= 0 && error.status <= 255 ? error.status : null,
      signal: ['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGINT'].includes(error.signal) ? error.signal : null,
      stdoutBytes: Math.min(1048576, Buffer.byteLength(error.stdout ?? '')),
      stderrBytes: Math.min(1048576, Buffer.byteLength(error.stderr ?? '')),
    };
    failure.journeyRefused = error.status === 1 && error.stdout?.length === 0
      && /Error: Invalid cloud cost browser journey/.test(error.stderr?.toString() ?? '');
    Object.assign(failure, parseBrowserDiagnostics(error.stderr?.toString() ?? ''));
    throw failure;
  }
}
