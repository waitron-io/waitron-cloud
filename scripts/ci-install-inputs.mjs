import assert from 'node:assert/strict';

const installInputs = [
  '100644 blob 0458d7abeecc6c7cdc016649bbf0aa5918d71cf6\t.dockerignore',
  '100644 blob 70fd08149c5917f95f18f52f66f38172af4312f8\t.env.example',
  '100644 blob 6e29ad9def2a84393d84be5526b7585689c8e079\t.gitignore',
  '100644 blob c497f12cf9a96298962ce3546e5a70ed423527b6\t.npmrc',
  '100644 blob 971b0ee514238e13bf21780566d349a25a5efe96\tapps/portal/package.json',
  '100644 blob eea3c685174e08fd1c096290e1ac0c139c722e1f\tcompose.yaml',
  '100644 blob 0c35d25a6cdcf1dd286a209be5051e211df6a797\tpackage.json',
  '100644 blob 559d3b0e13eb1cbefcce5e3ec478b35b8b8a1ffb\tpackages/account-http/package.json',
  '100644 blob ab4c519931d4a7aafd65f347deec0acf88bf213d\tpackages/backups/package.json',
  '100644 blob 84eb2b57ce3411e0f05ecd49a02d726018982b79\tpackages/fiscal-allocation/package.json',
  '100644 blob 7384839357d4b0b5322053daa0a0a607ff2787c6\tpackages/identity/package.json',
  '100644 blob 4ad264e2c4428ab69588d2ac1d58f963990a4030\tpackages/operations/package.json',
  '100644 blob 8bd23b3ab5931e0243756e0e9f2e2474304a71a4\tpackages/registration/package.json',
  '100644 blob 14e7a1a511911b087ce0e763abd350922403d872\tpackages/remote-access/package.json',
  '100644 blob 94ea5734a128370ccbecd98615ee8c0e5c263aa0\tpackages/ui-smoke/package.json',
  '100644 blob 583d808eed0331036c294476452349b1cab5d7ba\tpnpm-lock.yaml',
  '100644 blob 4e708bd3c5b28237a16b37d5ed737ce2d9450496\tpnpm-workspace.yaml',
  '100644 blob 6e606a5efb5613e22433f25cf8eab849e3b7e9ce\ttsconfig.json',
];

export function assertInstallationInputs(entries) {
  assert.ok(entries.every(entry => !/(?:^|\/)node_modules(?:\/|$)/.test(entry.split('\t')[1])), 'Tracked dependency overrides invalidate the audit');
  const installation = entries.filter(entry => {
    const path = entry.split('\t')[1];
    return path && ((!path.includes('/') && !path.endsWith('.md')) || /(?:^|\/)\.gitattributes$/.test(path) || /(?:^|\/)package\.json$/.test(path) || /^(?:packages|apps)\/[^/]+\/(?:\.npmrc|\.pnpmfile\.cjs)$/.test(path));
  });
  assert.deepEqual(installation, installInputs, 'Unaudited dependency installation inputs');
}
