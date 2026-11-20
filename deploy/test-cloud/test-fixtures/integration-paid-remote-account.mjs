import assert from 'node:assert/strict';
import {OrganisationPlanStore} from '../../../packages/registration/src/organisation-plans.ts';
import {RemoteAccessStore} from '../../../packages/remote-access/src/placement.ts';
import {validateCsr} from '../../../packages/remote-access/src/certificates.ts';
import {certificateNeedsRenewal} from '../../../packages/remote-access/src/renewal.ts';

export async function paidRemoteAccount({pool, config, organisationId, installationId, phase, peerPublicKey, csr, certificate}) {
  const cell = process.env.CLOUD_STOCKHOLM_REMOTE_CELL;
  const stockholm = process.env.CLOUD_STOCKHOLM_REHEARSAL === '1' && Boolean(cell);
  assert.equal(process.env.CLOUD_TEST_SERVICE_PLANS, stockholm ? '0' : '1');
  if (stockholm) assert.equal(process.env.CLOUD_VENUE_SERVICE_LEVELS, '0');
  const binding = (await pool.query(`SELECT v.organisation_id,v.environment,i.venue_id,i.configuration_revision,i.public_key,i.revoked_at,i.superseded_by
    FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1`, [installationId])).rows[0];
  assert.equal(binding.organisation_id, organisationId); assert.equal(binding.environment, 'test');
  const plans = new OrganisationPlanStore(pool);
  if (!stockholm) assert.equal((await plans.show(organisationId)).plan, 'paid');
  if (phase === 'stockholm-remote-publication') {
    assert.equal(stockholm, true);
    const {rows} = await pool.query(`SELECT kind, EXTRACT(EPOCH FROM last_success_at)::double precision AS completed,
        enabled AND status='pending' AND claim_id IS NULL AND available_at>clock_timestamp()
          AND applied_digest=desired_digest AND last_error IS NULL AS idle
      FROM remote_configuration_jobs WHERE (kind='certificate_public' AND target_id=$1)
        OR (kind='route' AND target_id=$2)`, [installationId, cell]);
    return Object.fromEntries(rows.map(({kind, completed, idle}) => [kind, {completed, idle}]));
  }
  if (phase === 'stockholm-remote-renew') {
    assert.equal(stockholm, true);
    const updated = await pool.query(`UPDATE remote_configuration_jobs SET available_at=clock_timestamp()
      WHERE kind='certificate_public' AND target_id=$1 AND enabled AND status='pending' AND last_success_at IS NOT NULL
      AND EXISTS(SELECT 1 FROM remote_placements p WHERE p.installation_id=$1 AND p.cell_id=$2)`, [installationId, cell]);
    assert.equal(updated.rowCount, 1, 'integration.stockholm_renew_binding');
    return {scheduled: true};
  }
  if (phase === 'paid-remote-downgrade') {
    assert.equal(stockholm, false);
    const result = await plans.set(organisationId, 'free');
    assert.equal(result.plan, 'free'); assert.equal(result.changed, true);
    const row = (await pool.query(`SELECT i.public_key,i.revoked_at,i.superseded_by,s.state,s.configuration
      FROM installations i JOIN installation_services s ON s.installation_id=i.id AND s.service='remote_access' WHERE i.id=$1`, [installationId])).rows[0];
    assert.equal(row.public_key, binding.public_key); assert.equal(row.revoked_at, null); assert.equal(row.superseded_by, null);
    assert.equal(row.state, 'unconfigured'); assert.deepEqual(row.configuration, {});
    return {plan: 'free', configurationCleared: true, installationPreserved: true};
  }
  if (phase === 'paid-remote-provision') {
    const placement = await new RemoteAccessStore(pool, stockholm ? 'existing' : 'test-free-paid').provision(installationId, stockholm ? cell : config.gateway.cellId, peerPublicKey);
    return placement;
  }
  assert.equal(phase, 'paid-remote-inspect');
  const hostname = 'staff-v-' + binding.venue_id + '.r.waitron.local';
  validateCsr(csr, hostname);
  assert.equal(certificateNeedsRenewal(certificate, csr, hostname), false);
  const row = (await pool.query('SELECT * FROM staff_certificate_exchange WHERE installation_id=$1', [installationId])).rows[0];
  assert.equal(row.hostname, hostname); assert.equal(row.csr, csr); assert.equal(row.certificate, certificate);
  assert.equal(row.revision, binding.configuration_revision); assert.equal(row.certificate_request_id, row.request_id);
  return {certificateBoundToPairedVenue: true};
}
