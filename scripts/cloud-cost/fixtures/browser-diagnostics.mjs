const phases = new Set(['options', 'meter', 'launch', 'context', 'login', 'dashboard',
  'reconnect', 'logout', 'close', 'accounting', 'snapshot']);

const steps = new Set(['reload', 'takings', 'overdue-empty', 'requests']);

export function parseBrowserDiagnostics(stderr) {
  const browserPhase = /(?:^|\n)cost_browser_phase=(options|meter|launch|context|login|dashboard|reconnect|logout|close|accounting|snapshot)\n/.exec(stderr)?.[1];
  const browserStep = browserPhase === 'reconnect'
    ? /(?:^|\n)cost_browser_step=(reload|takings|overdue-empty|requests)\n/.exec(stderr)?.[1] : undefined;
  return {browserPhase, browserStep};
}

export async function withBrowserDiagnostics(run, report) {
  try { return await run(); }
  catch (error) {
    const phase = error && Object.getOwnPropertyDescriptor(error, 'browserPhase')?.value;
    if (phases.has(phase)) report('cost_browser_phase=' + phase);
    const step = error && Object.getOwnPropertyDescriptor(error, 'browserStep')?.value;
    if (phase === 'reconnect' && steps.has(step)) report('cost_browser_step=' + step);
    throw error;
  }
}
