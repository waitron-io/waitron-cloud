import acme from 'acme-client';

export const checkAuthorization = 'synthetic-token.synthetic-thumbprint';

export async function challengeCertificate(hostname: string, expiresAt = Date.now() + 60_000) {
  const key = await acme.crypto.createPrivateEcdsaKey();
  const authorization = {identifier: {type: 'dns', value: hostname}, url: 'https://acme.example.test/authz', status: 'pending' as const, challenges: []};
  const [, certificate] = await acme.crypto.createAlpnCertificate(authorization, checkAuthorization, key);
  return {hostname, expiresAt, key: key.toString(), certificate: certificate.toString()};
}
