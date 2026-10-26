const preparationStages = new Set([
  'isolated-replay:intent', 'isolated-replay:ready', 'network:intent', 'network:started',
  'container:intent', 'container:started', 'outbound-proof:intent', 'outbound-proof:ready',
  'replay-isolation:ready', 'source-copy-stage:intent', 'source-copy-container:intent',
  'source-copy-container:created', 'source-copy-isolation:ready', 'database-copy:intent',
  'database-copy:ready', 'replay-worker:started',
]);

// The journal contains private IDs and paths; only fixed preparation stages may reach the test log.
export async function withOwnershipDiagnostics(operation, readJournal, observation, report) {
  try { return await operation(); }
  catch (error) {
    try {
      const observed = observation();
      const evidence = { schemaVersion: 1,
        elapsedMilliseconds: Number.isFinite(observed.elapsedMilliseconds)
          ? Math.min(1000000000, Math.max(0, Math.round(observed.elapsedMilliseconds))) : 0,
        changed: observed.changed === true, signalAborted: observed.signalAborted === true,
        journalReadable: false, workerStarted: null, lastPreparation: 'unknown' };
      try {
        const text = readJournal();
        if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) throw Error();
        const entries = JSON.parse(text).localResources ?? [];
        if (!Array.isArray(entries)) throw Error();
        evidence.journalReadable = true; evidence.workerStarted = false;
        for (const entry of entries) {
          const stage = typeof entry?.kind === 'string' && typeof entry?.state === 'string'
            ? entry.kind + ':' + entry.state : '';
          if (preparationStages.has(stage)) evidence.lastPreparation = stage;
          if (stage === 'replay-worker:started') evidence.workerStarted = true;
        }
      } catch { /* A missing journal must not turn a preparation failure into a reporting failure. */ }
      await report('ownership-start-refusal ' + JSON.stringify(evidence));
    } catch { /* Preserve the original assertion or runtime refusal when reporting fails. */ }
    throw error;
  }
}
