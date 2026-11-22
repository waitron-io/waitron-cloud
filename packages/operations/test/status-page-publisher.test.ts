import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { publishInvestigatingUpdate } from '../src/status-page-publisher.ts';

const incident = { service: 'remote_access', impact: 'some', confirmedAt: '2026-11-22T10:00:00Z' };

test('publishes both pages together and waits for the upload', async () => {
  let releaseUpload!: () => void;
  const upload = new Promise<void>((resolve) => { releaseUpload = resolve; });
  const batches: string[][] = [];
  let published = false;
  const publication = publishInvestigatingUpdate(incident, async (pages) => {
    batches.push(Object.keys(pages).sort());
    await upload;
  }).then(() => { published = true; });

  await setImmediate();
  assert.equal(published, false);
  releaseUpload();
  await publication;
  assert.deepEqual(batches, [['es/index.html', 'index.html']]);
});

test('rejects malformed incidents without sending anything to the uploader', async () => {
  const privateText = 'Private Venue <private@example.test>';
  const inheritedTime = Object.assign(Object.create({ confirmedAt: incident.confirmedAt }), {
    service: incident.service,
    impact: incident.impact,
    venueName: privateText,
  });
  const invalidIncidents = [
    ['missing confirmation time', { service: 'remote_access', impact: 'some' }],
    ['extra field', { ...incident, venueName: privateText }],
    ['inherited confirmation time with an extra field', inheritedTime],
    ['invalid service', { ...incident, service: privateText }],
    ['invalid impact', { ...incident, impact: privateText }],
    ['fractional seconds', { ...incident, confirmedAt: '2026-11-22T10:00:00.000Z' }],
    ['not an object', null],
  ] as const;
  const uploads: unknown[] = [];
  for (const [reason, input] of invalidIncidents) {
    await assert.rejects(publishInvestigatingUpdate(input, async (pages) => {
      uploads.push(pages);
    }), { message: 'Invalid public status input' }, reason);
  }
  assert.deepEqual(uploads, []);
});

test('reports the upload failure after one attempt', async () => {
  const failure = new Error('Local upload failed');
  let attempts = 0;
  const publication = publishInvestigatingUpdate(incident, async () => {
    attempts++;
    throw failure;
  });

  await assert.rejects(publication, (error: unknown) => error === failure);
  assert.equal(attempts, 1);
});
