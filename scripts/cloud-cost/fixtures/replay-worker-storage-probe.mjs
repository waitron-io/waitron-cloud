// Simulate the private worker's external inputs to exercise its real persisted diagnostic boundary.
import { registerHooks } from 'node:module';
const files = new Map();
globalThis.workerStorageProbe = {
  readFileSync: () => JSON.stringify({ stream: {} }),
  writeFileSync: (path, text, options) => {
    if (options?.flag === 'wx' && files.has(path)) throw Error('Already recorded');
    files.set(path, text);
  },
  mkdirSync: () => {}, copyFileSync: () => {}, unlinkSync: () => {}, lstatSync: () => ({ ino: 1, dev: 1 }),
  createRequire: () => () => ({}),
  openWorkerStorage: async ({ onDiagnostic }) => ({
    finish: async () => { onDiagnostic?.({ kind: 'storage-refusal', stage: 'object-list' }); throw Error('PRIVATE_SDK_ERROR'); },
    close: async () => {},
  }),
  replayPrivateDay: async () => ({ stream: { stream: { storage: { objects: {} } } } }),
};
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/replay-worker.mjs')) {
    const exports = {
      'node:fs': 'readFileSync,writeFileSync,mkdirSync,copyFileSync,unlinkSync,lstatSync',
      'node:module': 'createRequire', './worker-storage.mjs': 'openWorkerStorage', './private-replay.mjs': 'replayPrivateDay',
    }[specifier];
    if (exports) return { url: 'data:text/javascript,export const {' + exports + '}=globalThis.workerStorageProbe;'
      + (specifier === './worker-storage.mjs' ? 'export const streamCounters=x=>x;' : ''), shortCircuit: true };
  }
  return next(specifier, context);
} });
process.argv[1] = new URL('../replay-worker.mjs', import.meta.url).pathname;
await import('../replay-worker.mjs');
setImmediate(() => {
  console.log(JSON.stringify({ failure: JSON.parse(files.get('/state/worker-failure.json')),
    trace: JSON.parse(files.get('/state/worker-trace.json')) }));
});
