// Diagnostic stages are fixed codes. Raw worker errors never cross this boundary.
export function workerFailureStage(value) {
  const fail = () => { throw Error('Invalid cloud cost worker diagnostic'); };
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => !['schemaVersion', 'stage'].includes(key)
    || Object.getOwnPropertyDescriptor(value, key).get !== undefined)) fail();
  if (value.schemaVersion !== 1 || !['configuration', 'storage-open', 'replay', 'storage-cleanup', 'result'].includes(value.stage)) fail();
  return value.stage;
}
