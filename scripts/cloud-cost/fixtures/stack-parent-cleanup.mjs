import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertOwnedRoot } from '../schema.mjs';

// The parent's fallback requires this invocation's recorded IDs as well as fresh labels and names.
export function cleanupRecordedStack(args, project, docker) {
  assertOwnedRoot(args);
  const entries = JSON.parse(readFileSync(args.journal.path, 'utf8')).localResources ?? [];
  for (const kind of ['container', 'network']) {
    const ids = new Set(entries.filter(v => v.kind === kind && v.state === 'started').map(v => v.id));
    for (const id of ids) {
      assert.match(id, /^[a-f0-9]{64}$/);
      const present = kind === 'container' ? docker('ps', '-aq', '--no-trunc', '--filter', 'id=' + id)
        : docker('network', 'ls', '-q', '--no-trunc', '--filter', 'id=' + id);
      if (!present) continue;
      assert.equal(present, id);
      const rows = JSON.parse(kind === 'container' ? docker('inspect', id) : docker('network', 'inspect', id));
      assert.equal(rows.length, 1);
      const resource = rows[0];
      assert.equal(resource.Id, id);
      const labels = kind === 'container' ? resource.Config.Labels : resource.Labels;
      assert.equal(labels['io.waitron.cloud-cost.owner'], args.journal.token);
      if (kind === 'container') {
        assert.equal(labels['com.docker.compose.project'], project);
        const role = labels['io.waitron.cloud-cost.role'];
        assert.ok(['postgres', 's3', 'mailpit', 'waitron', 'fiscal', 'gateway'].includes(role));
        assert.equal(resource.Name, '/' + project + '-' + role);
        docker('rm', '-f', '-v', id);
      } else {
        assert.equal(resource.Name, project);
        docker('network', 'rm', id);
      }
    }
  }
}
