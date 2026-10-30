import { execFileSync } from 'node:child_process';
import { workerFailureTrace } from './worker-diagnostic.mjs';

const prefix = 'streamed-day-refusal ';
const stages = new Set(['setup', 'source-open', 'source-sale', 'source-close', 'source-copy', 'bucket', 'private-replay', 'result', 'unknown']);

// These fixtures may hold private data; only the closed worker vocabulary reaches the test log.
export async function withStreamedDayDiagnostics(operation, observation, report) {
  try { return await operation(); }
  catch (error) {
    try {
      const observed = observation();
      const evidence = { schemaVersion: 1, stage: stages.has(observed.stage) ? observed.stage : 'unknown', traceAvailable: false, trace: [] };
      try { evidence.trace = workerFailureTrace(observed.trace.slice(-32)); evidence.traceAvailable = true; }
      catch { /* An invalid trace must not hide the fixed outer stage. */ }
      await report(prefix + JSON.stringify(evidence));
    } catch { /* Reporting must preserve the original refusal and subsequent owned cleanup. */ }
    throw error;
  }
}

// Explicit output survives the command exception's abbreviated stderr rendering.
export function runStreamedDayFixture(command, args, options, report = text => console.error(text)) {
  try { return execFileSync(command, args, options); }
  catch (error) {
    try {
      const stderr = error.stderr;
      if ((typeof stderr === 'string' || Buffer.isBuffer(stderr)) && Buffer.byteLength(stderr) <= 65536) {
        for (const line of stderr.toString().split('\n')) {
          if (!line.startsWith(prefix)) continue;
          try {
            const evidence = JSON.parse(line.slice(prefix.length));
            if (Object.keys(evidence).sort().join(',') !== 'schemaVersion,stage,trace,traceAvailable'
              || evidence.schemaVersion !== 1 || !stages.has(evidence.stage) || typeof evidence.traceAvailable !== 'boolean'
              || !evidence.traceAvailable && evidence.trace.length !== 0) continue;
            const trace = workerFailureTrace(evidence.trace);
            report(prefix + JSON.stringify({ schemaVersion: 1, stage: evidence.stage, traceAvailable: evidence.traceAvailable, trace }));
            break;
          } catch { /* Unvalidated child text cannot become a public diagnostic. */ }
        }
      }
    } catch { /* Keep the actual command exit when inspection or output fails. */ }
    throw error;
  }
}
