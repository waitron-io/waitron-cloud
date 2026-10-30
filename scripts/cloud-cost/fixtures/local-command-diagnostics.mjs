import { withOwnershipDiagnostics } from './ownership-diagnostics.mjs';

const signals = new Set(['SIGINT', 'SIGTERM', 'SIGKILL']);
const count = value => Number.isFinite(value) ? Math.min(1000000000, Math.max(0, Math.round(value))) : 0;

// Child streams and journal IDs are private; publish only counts, fixed signals and preparation stages.
export async function withLocalCommandDiagnostics(operation, readJournal, observation, report) {
  let observed;
  return withOwnershipDiagnostics(operation, readJournal, () => (observed = observation()), async text => {
    const evidence = JSON.parse(text.slice('ownership-start-refusal '.length));
    evidence.requestedSignal = signals.has(observed.requestedSignal) ? observed.requestedSignal : 'unknown';
    evidence.sent = observed.sent === true;
    evidence.timerFired = observed.timerFired === true;
    evidence.childClosed = observed.result !== undefined;
    evidence.status = Number.isInteger(observed.result?.status) && observed.result.status >= 0 && observed.result.status <= 255
      ? observed.result.status : null;
    evidence.signal = signals.has(observed.result?.signal) ? observed.result.signal : null;
    evidence.stdoutBytes = count(observed.stdoutBytes);
    evidence.stderrBytes = count(observed.stderrBytes);
    await report('local-command-refusal ' + JSON.stringify(evidence));
  });
}
