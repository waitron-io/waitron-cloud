import {loadRuntime} from '../../local-stack/runtime.mjs';
import {testRuntimeEnvironment} from '../runtime.mjs';
import {openTestBackupVerifier, runTestBackupWorker} from '../backup-worker.mjs';

// The trusted worker owns the socket; its bounded verifier child receives no host mounts or network.
try {
  const environment = testRuntimeEnvironment('backup', await loadRuntime('/run/local-stack'), process.env);
  const opened = await openTestBackupVerifier({directory: environment.CLOUD_VERIFIER_STATE_DIR, image: environment.CLOUD_VERIFIER_IMAGE});
  console.log(JSON.stringify({controllerScope: opened.controllerScope}));
  await runTestBackupWorker(environment, []);
} catch {
  console.error('integration.verifier_worker_failed');
  process.exitCode = 1;
}
