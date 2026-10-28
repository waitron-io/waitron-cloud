export function assertWorkerResults<T>(
  stage: 'reserve' | 'retry',
  results: readonly unknown[],
  check: () => T,
  emit: (line: string) => void,
): T {
  try {
    return check();
  } catch (error) {
    // Failed assertions retain their identity; diagnostics disclose only fixed codes and presence.
    try {
      emit(JSON.stringify({
        fiscalWorkers: stage,
        results: results.slice(0, 2).map(result => {
          const code = ownValue(result, 'code');
          return {
            code: code === undefined ? 'none' : typeof code === 'string' && [
              'invalid_input', 'permission_denied', 'entitlement_unavailable',
              'custody_unavailable', 'continuity_unavailable', 'history_uncertain',
              'binding_conflict', 'allocation_unavailable', 'space_exhausted',
              'reservation_untrusted', 'unexpected_error', '57014', '40P01', '40001',
            ].includes(code) ? code : 'unknown',
            receipt: !!ownValue(result, 'receipt'),
          };
        }),
      }));
    } catch {}
    throw error;
  }
}

function ownValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
