const operations = new Set(['startup', 'authority-open', 'bucket-create', 'provision',
  'identity-reload', 'writer-put', 'reader-get']);

export function storageOperations(report) {
  return async (operation, run) => {
    try {return await run();}
    catch (error) {
      // Fixed labels need no credentials or error inspection; output cannot replace the refusal.
      try {if (operations.has(operation)) report('storage_authority_operation=' + operation);} catch {}
      throw error;
    }
  };
}
