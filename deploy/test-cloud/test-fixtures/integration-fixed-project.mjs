import assert from 'node:assert/strict';
import {withTestCloudProjectLock} from '../../../scripts/test-cloud-project-lock.mjs';

// A fixed namespace must be empty before admission; cleanup never adopts an existing resource.
export async function withFixedIntegrationProject({docker, run, lock}) {
  return withTestCloudProjectLock(async () => {
    const project = 'waitron-cloud-test';
    const selectors = [
      ['ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + project],
      ['ps', '-aq', '--no-trunc', '--filter', 'name=^waitron-cloud-test[-_]'],
      ...['network', 'volume'].flatMap(kind => [
        [kind, 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project],
        [kind, 'ls', '-q', '--filter', 'name=^waitron-cloud-test[-_]'],
      ]),
      ...['venue', 'recovery'].map(kind => ['image', 'ls', '-q', '--filter', 'reference=' + project + '-' + kind + ':*']),
      ...['cloud.backup-verifier.owner', 'cloud.integration.owner'].flatMap(label => [
        ['ps', '-aq', '--no-trunc', '--filter', 'label=' + label],
        ...['network', 'volume'].map(kind => [kind, 'ls', '-q', '--filter', 'label=' + label]),
      ]),
    ];
    for (const args of selectors) assert.equal((await docker(args)).trim(), '', 'integration.fixed_project_in_use');
    return await run(project);
  }, lock);
}
