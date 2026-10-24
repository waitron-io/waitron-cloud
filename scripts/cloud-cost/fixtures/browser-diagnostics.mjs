import {execFileSync} from 'node:child_process';

const phases = new Set(['options', 'meter', 'launch', 'context', 'login', 'dashboard',
  'reconnect', 'logout', 'close', 'accounting', 'snapshot']);

const steps = new Set(['reload', 'takings', 'overdue-empty', 'requests']);

// Diagnostic inspection must not replace the journey's original refusal.
function diagnosticValue(error, key) {
  try { return error && Object.getOwnPropertyDescriptor(error, key)?.value; }
  catch { return undefined; }
}

export function parseBrowserDiagnostics(stderr) {
  const browserPhase = /(?:^|\n)cost_browser_phase=(options|meter|launch|context|login|dashboard|reconnect|logout|close|accounting|snapshot)\n/.exec(stderr)?.[1];
  const browserStep = browserPhase === 'reconnect'
    ? /(?:^|\n)cost_browser_step=(reload|takings|overdue-empty|requests)\n/.exec(stderr)?.[1] : undefined;
  return {browserPhase, browserStep};
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
    } catch {}
    throw error;
  }
}

export function runBrowserFixture(command, args, environment) {
  try { return execFileSync(command, args, { env: environment, encoding: 'utf8', timeout: 30000,
    maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (error) {
    const failure = Error('Generated local gateway fixture failed');
    failure.journeyRefused = error.status === 1 && error.stdout?.length === 0
      && /Error: Invalid cloud cost browser journey/.test(error.stderr?.toString() ?? '');
    Object.assign(failure, parseBrowserDiagnostics(error.stderr?.toString() ?? ''));
    throw failure;
  }
}
