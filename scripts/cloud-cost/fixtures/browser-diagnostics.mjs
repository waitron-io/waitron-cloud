const phases = new Set(['options', 'meter', 'launch', 'context', 'login', 'dashboard',
  'reconnect', 'logout', 'close', 'accounting', 'snapshot']);

export async function withBrowserDiagnostics(run, report) {
  try { return await run(); }
  catch (error) {
    const phase = error && Object.getOwnPropertyDescriptor(error, 'browserPhase')?.value;
    if (phases.has(phase)) report('cost_browser_phase=' + phase);
    throw error;
  }
}
