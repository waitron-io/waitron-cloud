import { isProxy } from 'node:util/types';
import { workerFailureTrace } from '../worker-diagnostic.mjs';
import { withOwnershipDiagnostics } from './ownership-diagnostics.mjs';

const stages = new Set(['configuration', 'storage-open', 'replay', 'storage-cleanup', 'result', 'unknown', 'worker-diagnostic-invalid']);
const controllerStages = new Set(['worker-result', 'replay-admission', 'stream-admission']);
const data = (value, key) => value && !isProxy(value) ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;

// Refusals and private worker results may contain paths or raw output; publish only admitted fixed codes.
function summarizeRefusal(error) {
  const evidence = { reason: 'unknown', stage: 'unknown', controllerStage: 'unknown' };
  if (data(error, 'message') === 'Invalid isolated cloud cost replay') evidence.reason = 'isolated-replay';
  const diagnostic = data(error, 'diagnostic');
  const stage = data(diagnostic, 'stage'), controllerStage = data(diagnostic, 'controllerStage');
  if (stages.has(stage)) evidence.stage = stage;
  if (controllerStages.has(controllerStage)) evidence.controllerStage = controllerStage;
  const trace = data(diagnostic, 'trace');
  if (trace !== undefined) {
    try { evidence.trace = workerFailureTrace(trace); }
    catch { evidence.traceInvalid = true; }
  }
  if (data(diagnostic, 'traceInvalid') === true) evidence.traceInvalid = true;
  return evidence;
}

export async function withStreamResultDiagnostics(operation, readJournal, observation, report) {
  let observed;
  return withOwnershipDiagnostics(operation, readJournal, () => (observed = observation()), async text => {
    const evidence = JSON.parse(text.slice('ownership-start-refusal '.length));
    evidence.resultRead = observed.resultRead === true;
    evidence.refusal = summarizeRefusal(observed.refusal);
    await report('isolated-stream-result-refusal ' + JSON.stringify(evidence));
  });
}
