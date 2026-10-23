import assert from 'node:assert/strict';
import {generateKeyPairSync, sign, randomBytes, randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {RegistrationStore, SignupStore, transaction} from '@waitron-cloud/registration';
import {createSession} from '@waitron-cloud/identity';
import {BackupKeyVault} from '../../../packages/backups/src/keys.ts';
import {BackupCatalogue} from '../../../packages/backups/src/catalogue.ts';
import {ManagedStreams} from '../../../packages/backups/src/managed-streams.ts';
import {RecoveryRequests} from '../../../packages/backups/src/recovery-request.ts';
import {receipt} from '../../../packages/backups/src/storage.ts';
import {machineTarget} from '../../../packages/backups/test/fixtures/recovery-v2.ts';
import {admitPointFixture} from '../../../packages/backups/test/fixtures/verification.ts';
import {startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';

// Removing recovery-screen admission must expose the real approval and persisted venue here.
for (const locale of ['en', 'es'] as const) for (const source of ['snapshot', 'continuous'] as const) for (const journey of ['return-from-account', 'account-api', 'test-venue'] as const) test(`${locale} recovery scope ${source}: ${journey}`, async () => {
  const vault = new BackupKeyVault(randomBytes(32)), data = new Map<string, Buffer>();
  const objects = () => ({async read(k: string) {return data.get(k)!;}, async put(k: string, b: Uint8Array) {data.set(k, Buffer.from(b)); return receipt(b);}, async remove(k: string) {data.delete(k);}});
  const streamObjects = new Map<string, Buffer>();
  const managedStreams = {async provision(input: {venueId: string}) {return {writerReference: input.venueId, readerReference: input.venueId, writerCredentials: {accessKeyId: 'synthetic-writer', secretAccessKey: 'synthetic-secret'}};}, async read(_reference: string, _location: unknown, key: string) {return streamObjects.get(key)!;}, async reader() {throw Error('No stream credentials in this approval test');}};
  const f = await startPortalFixture({vault, objects, managedStreams, async grant() {throw Error('No storage grant in this approval test');}});
  try {
    const signup = new SignupStore(f.db.pool, f.db.outbox);
    await signup.request('recovery-scope@example.test');
    const mail = f.db.outbox.open((await f.db.pool.query('SELECT * FROM email_outbox')).rows[0]); assert('token' in mail);
    const owner = await signup.complete(mail.token, {password: 'A long synthetic owner password', organisationName: 'Café Sol', legalBusinessName: 'Sol SL', countryCode: 'ES'});
    const reg = new RegistrationStore(f.db.pool), binding = {operationId: randomUUID(), installationKey: machineTarget().publicKey, localVenueId: randomUUID(), environment: 'test', organisationId: owner.organisationId, legalBusinessId: owner.legalBusinessId};
    await reg.start(binding); await reg.approveCloud(binding, owner.accountId); await reg.approveLocal(binding, randomUUID()); const venue = await reg.complete(binding);
    const catalogue = new BackupCatalogue(f.db.pool, vault, objects);
    await catalogue.provision(venue.installationId, {endpoint: 'https://storage.test', region: 'local', bucket: 'recovery-' + randomUUID()});
    const capture = await catalogue.reserveCapture(venue.installationId, randomUUID()), bytes = Buffer.from('synthetic encrypted archive'); data.set(capture.incomingKey, bytes);
    const point = await catalogue.publish(venue.installationId, capture.id, {...receipt(bytes), capturedAt: new Date().toISOString(), retention: 'daily', sourceNodeId: randomUUID(), modules: {core: 1}});
    await admitPointFixture(f.db.pool, point.id);
    if (source === 'continuous') {
      const revision = Number((await f.db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1', [venue.installationId])).rows[0].configuration_revision), key = generateKeyPairSync('ed25519'), nodeId = randomUUID(), streams = new ManagedStreams(f.db.pool, vault, managedStreams);
      const configured = await streams.configure(venue.installationId, revision, {localVenueId: binding.localVenueId, sourceNodeId: nodeId, pointerSignerPublicKey: key.publicKey.export({type: 'spki', format: 'der'}).toString('base64')});
      const generation = `gen-2-${nodeId}-20261023T100000Z`, writtenAt = new Date(Date.now() - 60000).toISOString(), pointer = {venueId: binding.localVenueId, term: 2, nodeId, generation, writtenAt};
      const message = JSON.stringify({pointer: {generation, nodeId, term: 2, venueId: binding.localVenueId, writtenAt}, purpose: 'waitron.stream.pointer.v1'});
      streamObjects.set(`${configured.bucket.prefix}venues/${binding.localVenueId}/current.json`, Buffer.from(JSON.stringify({body: pointer, signature: sign(null, Buffer.from(message), key.privateKey).toString('base64')})));
      await streams.observe(venue.installationId, configured.configurationRevision);
    }
    // Seed retained metadata before marking the venue as production: normal capture
    // provisioning refuses production, but the metadata reader can still show it.
    if (journey !== 'test-venue') await f.db.pool.query("UPDATE venues SET environment='production' WHERE id=$1", [venue.venueId]);
    const target = machineTarget(); await new RecoveryRequests(f.db.pool, vault, f.origin).machine('start', target.envelope('start', '', Date.now(), f.origin, source === 'snapshot' ? 2 : 1));
    const session = await transaction(f.db.pool, c => createSession(c, owner.accountId));
    const context = await f.browser.newContext({locale, viewport: {width: 390, height: 900}}), page = await context.newPage(), c = translations[locale]; page.setDefaultTimeout(6000);
    await context.addCookies([{name: 'cloud_session', value: session.token, url: f.origin, httpOnly: true}, {name: 'cloud_csrf', value: session.csrfToken, url: f.origin}]);
    const approvals: {sent: unknown; status: number}[] = [];
    page.on('response', response => {if (response.url().endsWith('/api/account/recovery/approve')) approvals.push({sent: response.request().postDataJSON(), status: response.status()});});
    await page.goto(f.origin + '/recover#request=' + target.id);
    await page.getByLabel(c.pairCode).fill(target.code); await page.getByRole('button', {name: c.pairInspect, exact: true}).click(); await page.getByLabel(c.recoveryVenue, {exact: true}).waitFor();
    const offered = await page.getByLabel(c.recoveryVenue, {exact: true}).locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value));
    assert.equal(offered.includes(venue.venueId), journey === 'test-venue');
    if (journey === 'test-venue') {
      await page.getByLabel(c.recoveryVenue, {exact: true}).selectOption(venue.venueId);
      await page.getByRole('checkbox', {name: c.recoveryStopped, exact: true}).waitFor();
    } else {
      await page.getByRole('link', {name: c.account, exact: true}).click();
      await page.getByRole('button', {name: c.viewSnapshots, exact: true}).click();
      await page.getByLabel(c.chooseSnapshot, {exact: true}).waitFor();
      assert.equal(await page.getByRole('button', {name: c.recoveryApprove, exact: true}).count(), 0);
      if (journey === 'account-api') {
        const sent = {requestId: target.id, code: target.code, ...(source === 'snapshot' ? {source: 'snapshot', pointId: point.id} : {source: 'continuous', venueId: venue.venueId}), oldServerUnavailable: 'true', acceptDataLoss: 'true'};
        const response = await context.request.post(f.origin + '/api/account/recovery/approve', {data: sent, headers: {origin: f.origin, 'x-csrf-token': session.csrfToken}});
        approvals.push({sent, status: response.status()});
        assert.equal(response.status(), 403, await response.text());
      } else {
        await page.goBack(); await page.getByRole('heading', {name: c.recoveryTitle, exact: true}).waitFor();
      }
    }
    const approve = page.getByRole('button', {name: c.recoveryApprove, exact: true});
    const exposed = await approve.count();
    if (exposed) {
      await page.getByRole('checkbox', {name: c.recoveryStopped, exact: true}).check(); await page.getByRole('checkbox', {name: c.recoveryAcceptLoss, exact: true}).check();
      const replied = page.waitForResponse(r => r.url().endsWith('/api/account/recovery/approve'));
      await approve.click(); assert.equal((await replied).status(), journey === 'test-venue' ? 200 : 403);
      if (journey === 'test-venue') await page.getByText(c.recoveryApprovedSnapshot, {exact: true}).waitFor();
    }
    const rows = (await f.db.pool.query('SELECT venue_id,point_id,source_kind FROM backup_recoveries WHERE id=$1', [target.id])).rows;
    console.log('RECOVERY_SCOPE_JOURNEY', JSON.stringify({locale, source, journey, environment: journey === 'test-venue' ? 'test' : 'production', offered, exposed, approvals, stored: rows}));
    if (journey === 'return-from-account') {
      assert.equal(exposed, 0, 'Recovery must not expose approval for a production venue opened on Account');
      assert.deepEqual(approvals, []); assert.deepEqual(rows, []);
      assert.equal(await page.getByRole('region', {name: c.recoverySource, exact: true}).count(), 0);
    } else if (journey === 'account-api') {
      assert.equal(approvals.length, 1); assert.equal(approvals[0]!.status, 403); assert.deepEqual(rows, []);
    } else {
      assert.equal(approvals.length, 1); assert.equal(approvals[0]!.status, 200);
      assert.deepEqual(approvals[0]!.sent, {requestId: target.id, code: target.code, ...(source === 'snapshot' ? {source: 'snapshot', pointId: point.id} : {source: 'continuous', venueId: venue.venueId}), oldServerUnavailable: 'true', acceptDataLoss: 'true'});
      assert.deepEqual(rows, [{venue_id: venue.venueId, point_id: source === 'snapshot' ? point.id : null, source_kind: source}]);
    }
    await context.close();
  } finally {await f.close();}
});
