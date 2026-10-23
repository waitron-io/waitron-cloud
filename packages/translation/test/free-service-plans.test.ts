import assert from 'node:assert/strict';
import {generateKeyPairSync, randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createLeaseIssuer, OrganisationPlanStore} from '@waitron-cloud/registration';
import {TranslationMachine, TranslationWorker, createLoopbackOpenAiClient} from '../src/index.ts';
import {connectedVenue, database, giveConsent, readyForTranslation} from './fixtures.ts';
import {echoFirstPass, emptyReview, isReview, startFakeOpenAi} from './fake-openai.ts';

// Moving submit admission before retry, or adding plan/consent gates to reads, loses durable work.
test('free and paid plan transitions preserve translation retry, collection and release exceptions', async () => {
  const db = await database();
  const fake = await startFakeOpenAi(request => isReview(request) ? emptyReview() : echoFirstPass(request));
  try {
    const origin = 'https://cloud.example.test';
    const issuer = createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64url'));
    const machine = new TranslationMachine(db.pool, issuer, origin), plans = new OrganisationPlanStore(db.pool);
    const worker = new TranslationWorker(db.pool, createLoopbackOpenAiClient({apiKey: 'local-fake-only', baseUrl: fake.baseUrl}), {wait: async () => {}});
    for (const plan of ['free', 'paid'] as const) {
      const venue = await connectedVenue(db, issuer, origin);
      await plans.set(venue.organisationId, plan);
      await readyForTranslation(db, venue);
      const text = JSON.stringify({version: 1, country: 'ES', languages: {default: 'ca', enabled: ['ca', 'es']},
        items: [{ref: 'product:1', kind: 'product', family: 'product:1', category: 'BAR', staffName: 'Cafe', existing: {}, missing: ['ca', 'es']}], houseStyle: []});
      const operationId = randomUUID();
      const submit = () => {const signed = venue.submit(text, operationId); return machine.execute('translation-submit', {payload: signed.payload, signature: signed.signature}, text);};
      await assert.rejects(submit(), (error: any) => error.code === 'consent_required');
      await giveConsent(db, venue);
      const first = await submit(); assert.equal(first.state, 'queued');
      assert.equal(await worker.runOnce(new AbortController().signal), true);
      await plans.set(venue.organisationId, plan === 'free' ? 'paid' : 'free');
      await plans.set(venue.organisationId, plan);
      await db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1 AND service='content_translation'", [venue.installationId]);
      await db.pool.query('DELETE FROM translation_consents WHERE venue_id=$1', [venue.venueId]);
      const retry = await submit(); assert.equal(retry.jobId, first.jobId); assert.equal(retry.state, 'done');
      const act = (action: 'translation-status' | 'translation-collect' | 'translation-release', body = {version: 1, jobId: first.jobId}) => machine.execute(action, venue.proof(action, body, randomUUID(), venue.lease));
      assert.equal((await act('translation-status')).state, 'done');
      const collected = await act('translation-collect');
      assert.deepEqual(collected.results, [{ref: 'product:1', names: {ca: 'Cafe [ca]', es: 'Cafe [es]'}, placeholder: false, corrections: []}]);
      assert.equal(collected.nextCursor, null);
      assert.equal((await act('translation-release')).state, 'collected');
      await assert.rejects(act('translation-collect'), (error: any) => error.code === 'expired');
    }
    assert.ok(fake.requests.length >= 4);
  } finally {await fake.close(); await db.close();}
});
