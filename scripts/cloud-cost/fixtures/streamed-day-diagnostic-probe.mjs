// Replace only external filesystem/database/SDK inputs; execute the actual smoke script and reporter.
import { registerHooks } from 'node:module';
const mode = process.argv[2];
let closed = false, removed = false;
const sdk = {
  S3Client: class { async send() { return { Contents: [] }; } destroy() {} },
  CreateBucketCommand: class {}, ListObjectsV2Command: class {}, DeleteObjectCommand: class {}, DeleteBucketCommand: class {},
};
globalThis.streamedDayProbe = {
  mkdirSync() {}, writeFileSync() {}, existsSync: () => false,
  rmSync() { removed = true; },
  readFileSync(path) {
    if (path.endsWith('replay-config.json')) return JSON.stringify({ config: {}, initial: {} });
    if (path.endsWith('journal.json')) return JSON.stringify({ localResources: [] });
    return 'PRIVATE_DATABASE';
  },
  createRequire: () => () => sdk,
  DatabaseSync: class { prepare() { return { get: () => ({ id: 'PRIVATE_ID' }) }; } close() {} },
  openReplay: async () => {
    if (mode === 'source') throw Error('PRIVATE_SOURCE');
    return { async recordSale() {}, async close() { closed = true; } };
  },
  preparePrivateCopy: async () => ({ database: '/PRIVATE_COPY', async close() {} }),
  replayPrivateDay: async args => {
    args.onDiagnostic({ kind: 'replay', stage: 'stream-finish' });
    args.onDiagnostic({ kind: 'stream-refusal', stage: 'quiesce-checkpoint' });
    if (mode === 'cancel') args.onProgress({ phase: 'workload', successfulSales: 1 });
    throw Error('PRIVATE_REPLAY_ERROR /state/private');
  },
};
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/streamed-day-smoke.mjs')) {
    const names = {
      'node:fs': 'mkdirSync,readFileSync,writeFileSync,rmSync,existsSync',
      'node:module': 'createRequire', 'node:sqlite': 'DatabaseSync',
      '/code/cost-waitron-adapter.mjs': 'openReplay',
      '/code/cloud-cost-runner/local.mjs': 'preparePrivateCopy',
      '/code/cloud-cost-runner/private-replay.mjs': 'replayPrivateDay',
    }[specifier];
    if (names) return { url: 'data:text/javascript,export const {' + names + '}=globalThis.streamedDayProbe;', shortCircuit: true };
    if (specifier === '/code/cloud-cost-runner/streamed-day-diagnostics.mjs')
      return next(new URL('../streamed-day-diagnostics.mjs', import.meta.url).href, context);
  }
  return next(specifier, context);
} });
process.argv[2] = mode === 'cancel' ? 'cancel' : 'normal';
await import('./streamed-day-smoke.mjs');
console.log('\n' + JSON.stringify({ closed, removed }));
