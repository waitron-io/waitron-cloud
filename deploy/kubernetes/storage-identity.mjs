import {createHash, createPublicKey, X509Certificate} from 'node:crypto';
import {issuerHost, storageNamespace as namespace} from './secrets.mjs';

const image = 'node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1';
const name = 'storage-identity';
const port = 8443;
const labels = {app: name};
export const issuer = 'https://' + issuerHost + ':' + port;
export const audience = 'waitron-stockholm-storage';
export const discoveryPath = '/.well-known/openid-configuration';
export const policyName = 'waitron-stockholm-scoped';

const serve = `
import {readFileSync} from 'node:fs';
import {createServer} from 'node:https';
const documents = new Map([
  ['${discoveryPath}', readFileSync('/public-identity/discovery.json')],
  ['/jwks', readFileSync('/public-identity/jwks.json')],
]);
createServer({
  key: readFileSync('/issuer-tls/tls.key'),
  cert: readFileSync('/issuer-tls/tls.crt'),
}, (request, response) => {
  const document = request.method === 'GET' && documents.get(request.url);
  if (!document) return response.writeHead(404).end();
  response.writeHead(200, {'content-type': 'application/json'}).end(document);
}).listen(${port}, '0.0.0.0');
`;

function signingIdentity(custody, role) {
  const publicKey = createPublicKey(custody.signingKey);
  const keyId = createHash('sha256').update(publicKey.export({format: 'der', type: 'spki'})).digest('base64url');
  const jwks = {keys: [{...publicKey.export({format: 'jwk'}), kid: keyId, alg: 'RS256', use: 'sig'}]};
  return {jwks, authority: {issuer, audience, keyId, privateKey: custody.signingKey,
    roles: {capture: role, stream: role, restore: role}}};
}

export function storageIdentity(custody, role) {
  // Expired TLS stops the issuer without taking the backup master key out of custody.
  const certificate = new X509Certificate(custody.certificate);
  const now = Date.now();
  if (now < certificate.validFromDate.getTime() || now > certificate.validToDate.getTime()) {
    throw Error('storage_identity.issuer_certificate_time');
  }
  const {authority, jwks} = signingIdentity(custody, role);
  const discovery = {issuer, jwks_uri: issuer + '/jwks'};
  const metadata = {name, namespace};
  return {discovery, jwks, authority, resources: [
    {apiVersion: 'v1', kind: 'ConfigMap', metadata,
      data: {'discovery.json': JSON.stringify(discovery), 'jwks.json': JSON.stringify(jwks)}},
    {apiVersion: 'v1', kind: 'Secret', metadata, type: 'kubernetes.io/tls',
      stringData: {'tls.crt': custody.certificate, 'tls.key': custody.tlsKey}},
    {apiVersion: 'v1', kind: 'Service', metadata,
      spec: {selector: labels, ports: [{name: 'https', port}]}},
    {apiVersion: 'apps/v1', kind: 'Deployment', metadata,
      spec: {replicas: 2, selector: {matchLabels: labels}, template: {metadata: {labels}, spec: {
        automountServiceAccountToken: false,
        securityContext: {runAsNonRoot: true, runAsUser: 1000, seccompProfile: {type: 'RuntimeDefault'}},
        affinity: {podAntiAffinity: {requiredDuringSchedulingIgnoredDuringExecution: [
          {topologyKey: 'kubernetes.io/hostname', labelSelector: {matchLabels: labels}},
        ]}},
        containers: [{name, image, command: ['node', '--input-type=module', '-e', serve],
          ports: [{name: 'https', containerPort: port}],
          readinessProbe: {httpGet: {scheme: 'HTTPS', path: discoveryPath, port: 'https'}},
          securityContext: {readOnlyRootFilesystem: true, allowPrivilegeEscalation: false, capabilities: {drop: ['ALL']}},
          volumeMounts: [
            {name: 'documents', mountPath: '/public-identity', readOnly: true},
            {name: 'tls', mountPath: '/issuer-tls', readOnly: true},
          ],
        }],
        volumes: [{name: 'documents', configMap: {name}}, {name: 'tls', secret: {secretName: name}}],
      }}},
    },
  ]};
}

export function storageRuntime(custody, role, endpoint, region, caFile, credentials) {
  return {
    CLOUD_BACKUP_MASTER_KEY: custody.masterKey,
    CLOUD_BACKUP_AUTHORITY: JSON.stringify(signingIdentity(custody, role).authority),
    CLOUD_BACKUP_ENDPOINT: endpoint,
    CLOUD_BACKUP_REGION: region,
    CLOUD_BACKUP_CA_FILE: caFile,
    CLOUD_BACKUP_ACCESS_KEY: credentials.accessKeyId,
    CLOUD_BACKUP_SECRET_KEY: credentials.secretAccessKey,
  };
}
