import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {makeAuthority} from '/waitron/packages/fiscal-verifactu/test/certificate-fixtures.ts';
import {sealAeatSecret} from '/waitron/packages/fiscal-verifactu/src/provisioning-secret.ts';
import {loadBoxEnv} from '/waitron/apps/server/src/box-env.ts';
const require = createRequire('/waitron/apps/server/package.json');
const {openVenueDatabase} = require('@waitron/db'), {loadKeyRing} = require('@waitron/credentials');

// A complete disposable preproduction archive uses the normal vault writer for its test certificate.
export async function prepareIntegrationVerificationState(root) {
  assert.equal(process.env.CLOUD_TEST_BACKUP_STATE, '1');
  const saved = JSON.parse(await readFile(root + '/fixture-env.json', 'utf8'));
  const certificate = makeAuthority().issue({organizationIdentifier: 'VATES-73000001K'});
  const store = await openVenueDatabase(root + '/venue', {exclusive: false});
  try {
    await sealAeatSecret({db: store.venue, ring: loadKeyRing(await loadBoxEnv({}, root)), nodeId: saved.WAITRON_TILL_NODE_ID},
      {pfxBase64: certificate.pfx.toString('base64'), passphrase: certificate.passphrase, certKind: 'sello'});
  } finally {await store.close();}
  return {testCertificateInstalled: true};
}
