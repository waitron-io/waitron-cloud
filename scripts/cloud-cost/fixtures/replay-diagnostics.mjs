// Node's test reporter abbreviates nested Error properties; explicit JSON preserves the admitted trace.
export async function withReplayDiagnostics(operation, report) {
  try { return await operation(); }
  catch (error) {
    // Diagnostic inspection and output must preserve the original replay refusal.
    try {
      const diagnostic = error && Object.getOwnPropertyDescriptor(error, 'diagnostic')?.value;
      if (diagnostic) report(JSON.stringify(diagnostic));
    } catch {}
    throw error;
  }
}
