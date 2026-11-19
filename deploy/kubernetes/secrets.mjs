import {createPrivateKey, generateKeyPairSync, randomBytes, X509Certificate} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const storageNamespace = 'd621-store';
export const issuerHost = 'storage-identity.' + storageNamespace + '.svc.cluster.local';

export async function createStorageCustody(directory, run) {
  // A separate create operation keeps an incomplete or lost inventory from silently rotating on restart.
  await mkdir(directory, {mode: 0o700});
  const {privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048,
    privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}});
  await writeFile(join(directory, 'signing.pem'), privateKey, {mode: 0o600});
  await writeFile(join(directory, 'master.key'), randomBytes(32).toString('hex'), {mode: 0o600});
  const tlsKey = join(directory, 'issuer.key');
  await writeFile(tlsKey, '', {mode: 0o600});
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=' + issuerHost, '-addext', 'subjectAltName=DNS:' + issuerHost,
    '-addext', 'basicConstraints=critical,CA:TRUE', '-out', join(directory, 'issuer.crt'), '-keyout', tlsKey]);
  return readStorageCustody(directory);
}

export async function readStorageCustody(directory) {
  try {
    const [signingKey, masterKey, certificate, tlsKey] = await Promise.all(
      ['signing.pem', 'master.key', 'issuer.crt', 'issuer.key'].map(name => readFile(join(directory, name), 'utf8')));
    const key = createPrivateKey(signingKey), tlsCertificate = new X509Certificate(certificate);
    const now = Date.now();
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048 ||
        !/^[a-f0-9]{64}$/.test(masterKey) || !tlsCertificate.ca || !tlsCertificate.checkHost(issuerHost) ||
        !tlsCertificate.checkPrivateKey(createPrivateKey(tlsKey)) ||
        now < tlsCertificate.validFromDate.getTime() || now >= tlsCertificate.validToDate.getTime()) {
      throw Error('invalid custody');
    }
    return {signingKey, masterKey, certificate, tlsKey};
  } catch {
    // Do not print key material or a parser error from private input.
    throw Error('storage_identity.custody_unavailable');
  }
}
