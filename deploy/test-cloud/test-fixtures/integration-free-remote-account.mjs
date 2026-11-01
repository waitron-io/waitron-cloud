import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {OrganisationPlanStore} from '../../../packages/registration/src/organisation-plans.ts';
import {RemoteAccessStore} from '../../../packages/remote-access/src/placement.ts';
import {validateCsr} from '../../../packages/remote-access/src/certificates.ts';

export async function freeRemoteAccount({pool, config, installationId, organisationId, phase, csr}) {
  assert.equal(process.env.CLOUD_TEST_SERVICE_PLANS, '1');
  const binding = (await pool.query(`SELECT i.venue_id,v.organisation_id,v.environment FROM installations i
    JOIN venues v ON v.id=i.venue_id WHERE i.id=$1`, [installationId])).rows[0];
  assert.equal(binding.organisation_id, organisationId);
  assert.equal(binding.environment, 'test');
  const plan = await new OrganisationPlanStore(pool).show(organisationId);
  assert.equal(plan.plan, 'free');
  const state = async () => {
    const row = (await pool.query(`SELECT i.configuration_revision,s.state,s.configuration FROM installations i
      JOIN installation_services s ON s.installation_id=i.id AND s.service='remote_access' WHERE i.id=$1`, [installationId])).rows[0];
    assert.ok(row);
    return row;
  };
  const counts = async () => {
    const result = {};
    for (const [name, sql, id] of [
      ['placements', 'SELECT count(*) FROM remote_placements WHERE installation_id=$1', installationId],
      ['hostnames', 'SELECT count(*) FROM remote_hostnames WHERE venue_id=$1', binding.venue_id],
      ['requests', 'SELECT count(*) FROM staff_certificate_exchange WHERE installation_id=$1', installationId],
      ['jobs', 'SELECT count(*) FROM remote_configuration_jobs WHERE target_id=$1', installationId],
    ]) {
      result[name] = Number((await pool.query(sql, [id])).rows[0].count);
      assert.equal(result[name], 0, 'integration.free_remote_' + name);
    }
    return result;
  };
  const baseline = '/run/local-stack/free-remote-' + installationId + '.json';
  if (phase === 'free-remote-prepare') {
    const before = await state();
    assert.equal(before.state, 'unconfigured');
    await counts();
    const peer = generateKeyPairSync('x25519').publicKey.export({format: 'der', type: 'spki'}).subarray(-32).toString('base64');
    let provision;
    try {await new RemoteAccessStore(pool, 'test-free-paid').provision(installationId, config.gateway.cellId, peer);}
    catch (error) {provision = error.message;}
    assert.equal(provision, 'permission_denied', 'integration.free_remote_provision');
    await writeFile(baseline, JSON.stringify(before), {mode: 0o600, flag: 'wx'});
    return {hostname: 'staff-v-' + binding.venue_id + '.r.waitron.local', revision: before.configuration_revision, provision};
  }
  assert.equal(phase, 'free-remote-inspect');
  validateCsr(csr, 'staff-v-' + binding.venue_id + '.r.waitron.local');
  assert.deepEqual(await state(), JSON.parse(await readFile(baseline, 'utf8')), 'integration.free_remote_configuration');
  return {...await counts(), configurationUnchanged: true, plan: plan.plan};
}
