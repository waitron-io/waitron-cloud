// Node's test reporter abbreviates nested Error properties; explicit JSON preserves the admitted trace.
export async function withReplayDiagnostics(operation, report) {
  try { return await operation(); }
  catch (error) {
    if (error.diagnostic) report(JSON.stringify(error.diagnostic));
    throw error;
  }
}
