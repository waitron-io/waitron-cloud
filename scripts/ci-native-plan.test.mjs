import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';

// A false-valued call input still identifies a reusable invocation. Ignoring it
// would turn a nightly PR rehearsal into an unselected portal-only proof.
for (const file of ['cloud-cost', 'venue-services-proof', 'aws-infrastructure', 'download-supervision-diagnostic']) {
  test(`${file} executed planner forces every reusable invocation full`, () => {
    const root = mkdtempSync(join(tmpdir(), 'cloud-native-plan-'));
    const git = (...args) => execFileSync('git', [...args], {cwd: root, encoding: 'utf8', stdio: 'pipe'}).trim();
    try {
      git('init', '-b', 'main'); git('config', 'user.name', 'CI test'); git('config', 'user.email', 'ci@example.test');
      writeFileSync(join(root, 'README.md'), '# Initial\n'); git('add', '.'); git('commit', '-sm', 'Initial'); const base = git('rev-parse', 'HEAD');
      mkdirSync(join(root, 'apps/portal/src'), {recursive: true}); writeFileSync(join(root, 'apps/portal/src/control.ts'), 'export {};\n');
      git('add', '.'); git('commit', '-sm', 'Portal'); const head = git('rev-parse', 'HEAD');
      const event = join(root, 'event.json'), output = join(root, 'output');
      const repo = {id: 123, full_name: 'waitron-io/waitron-cloud'};
      writeFileSync(event, JSON.stringify({number: 51, pull_request: {number: 51, base: {sha: base, ref: 'main', repo}, head: {sha: head, ref: 'feature', repo}}}));
      const apiRun = {id: 42, run_attempt: 1, workflow_id: 17, path: `.github/workflows/${file}.yml`, event: 'pull_request', head_sha: head, repository: repo, head_repository: repo};
      writeFileSync(join(root, 'gh'), `#!/bin/sh
printf 'HTTP/1.1 200 OK\\r\\n\\r\\n'
cat <<'JSON'
${JSON.stringify(apiRun)}
JSON
`, {mode: 0o700});
      const run = (inputs, record = false) => {
        writeFileSync(output, '');
        const result = spawnSync(process.execPath, [resolve('scripts/ci-native-plan.mjs')], {cwd: root, encoding: 'utf8', env: {...process.env,
          CI_WORKFLOW_PATH: `.github/workflows/${file}.yml`, CI_WORKFLOW_INPUTS: JSON.stringify(inputs), CI_FORCE_FULL: 'false',
          GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: head, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, CI_RECORD_EVIDENCE: String(record), PATH: `${root}:${process.env.PATH}`,
          GITHUB_REPOSITORY: repo.full_name, GITHUB_REPOSITORY_ID: '123', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1',
          GITHUB_WORKFLOW_REF: `${repo.full_name}/.github/workflows/${file}.yml@refs/pull/51/merge`, GITHUB_WORKFLOW_SHA: base}});
        assert.equal(result.status, 0, result.stdout + result.stderr);
        return Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => {const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];}));
      };
      const recorded = run({}, true);
      assert.equal(recorded.source_artifact, `ci-plan-v1-${file}-42-1`);
      const evidence = JSON.parse(readFileSync(join(root, '.ci-evidence/source/plan.json'), 'utf8'));
      assert.equal(evidence.workflow.id, 17); assert.equal(evidence.checkout.sha, head);
      assert.deepEqual(evidence.selection, JSON.parse(recorded.plan));
      const ordinary = run({});
      assert.equal(ordinary.required, ['cloud-cost', 'venue-services-proof'].includes(file) ? 'false' : 'true');
      for (const full of [false, true]) {
        const output = run({full});
        assert.equal(output.source_artifact, undefined); assert.equal(output.decision_artifact, undefined);
        assert.equal(output.required, 'true'); assert.equal(output.mode, 'full');
        assert.equal(JSON.parse(output.plan).full, true);
        if (file === 'cloud-cost') assert.equal(JSON.parse(output.files).length, 21);
      }
    } finally {rmSync(root, {recursive: true, force: true});}
  });
}
