import {storageNamespace} from './secrets.mjs';
import {cloudContainer, caVolume, requireTls} from '../../scripts/kubernetes-database.mjs';

export const outsideMailHost = '10.77.0.4';
export const mailpitImage = 'axllent/mailpit:v1.31.1';
export const servicesNamespace = 'd621-data';
export const servicesOrigin = 'https://cloud.example.test:3000';
export const servicesStoreHost = 's3.' + storageNamespace + '.svc.cluster.local';
export const verifierScratchPath = '/var/local/d621-verifier-scratch';
export const verifierScratchVolume = 'd621-verifier-scratch';
const publicStoreCa = {name: 'store-ca', configMap: {name: 'services-store-ca'}};
const storeMount = {name: publicStoreCa.name, mountPath: '/run/store-ca', readOnly: true};
export const storeCaPath = storeMount.mountPath + '/ca.crt';
const configuration = {NODE_ENV: 'production', CLOUD_TEST_SERVICE_PLANS: '0',
  CLOUD_VENUE_SERVICE_LEVELS: '0', CLOUD_REQUIRE_ENROLLMENT: 'false'};
const env = values => Object.entries(values).map(([name, value]) => ({name, value}));

function service(image, name, entry, {variables = {}, secret, storage = false, wait = ''} = {}) {
  const container = cloudContainer(image, name, 'cloud-db-app', ['sh', '-ec',
    requireTls + wait + 'exec node deploy/local-stack/schema-consumer.mjs ' + entry]);
  return {...container, env: [...container.env, ...env({...configuration, ...variables})],
    volumeMounts: [...container.volumeMounts, ...(storage ? [storeMount] : [])],
    ...(secret && {envFrom: [{secretRef: {name: secret}}]})};
}

export const mailpitArguments = host => [
  '--smtp', host + ':1025', '--listen', host + ':8025', '--smtp-require-tls',
  '--smtp-tls-cert', '/run/mail/tls.crt', '--smtp-tls-key', '/run/mail/tls.key',
  '--smtp-auth-file', '/run/mail/smtp-auth', '--ui-auth-file', '/run/mail/ui-auth',
  '--smtp-allowed-recipients', '^[^@]+@[^@]+\\.test$', '--smtp-disable-rdns',
];

export function servicesPod(image, nodeName, remote) {
  const mount = (name, mountPath) => ({name, mountPath, readOnly: true});
  const account = service(image, 'account', 'packages/account-http/src/server-cli.ts', {
    storage: true, secret: 'services-account', variables: {CLOUD_HTTP_HOST: '127.0.0.1',
      CLOUD_HTTP_TRUSTED_PROXY_IPS: '127.0.0.1', CLOUD_PORTAL_ORIGIN: servicesOrigin,
      ...(remote && {CLOUD_STAFF_CERTIFICATES: '1'}), CLOUD_COMPROMISED_PASSWORD_CORPUS: '/run/proxy/passwords.sha256'},
  });
  account.volumeMounts.push(mount('proxy', '/run/proxy'));
  const email = service(image, 'email', 'packages/registration/src/email-worker-cli.ts', {
    secret: 'services-email', variables: {CLOUD_MAIL_TRANSPORT: 'smtp', CLOUD_SMTP_HOST: '127.0.0.1',
      CLOUD_SMTP_PORT: '1025', CLOUD_MAIL_FROM: 'cloud@example.test', CLOUD_PORTAL_ORIGIN: servicesOrigin,
      NODE_EXTRA_CA_CERTS: '/run/proxy/ca.crt'},
  });
  email.volumeMounts.push(mount('proxy', '/run/proxy'));
  const proxy = {name: 'proxy', image, imagePullPolicy: 'Never',
    command: ['haproxy', '-W', '-db', '-f', '/run/proxy/haproxy.cfg'],
    ports: [{containerPort: 3443, hostPort: 3000}],
    env: env({TEST_CLOUD_CERTIFICATE: '/run/proxy-key/proxy.pem', TEST_CLOUD_HOST: new URL(servicesOrigin).host,
      TEST_CLOUD_ORIGIN: servicesOrigin}),
    volumeMounts: [mount('proxy', '/run/proxy'), mount('proxy-key', '/run/proxy-key')],
    readinessProbe: {tcpSocket: {port: 3443}}};
  const mailpit = {name: 'mailpit', image: mailpitImage, args: mailpitArguments('127.0.0.1'),
    volumeMounts: [mount('mail', '/run/mail')]};
  return {apiVersion: 'v1', kind: 'Pod', metadata: {name: 'cloud-services', namespace: servicesNamespace},
    spec: {nodeName, restartPolicy: 'Never', automountServiceAccountToken: false,
      volumes: [caVolume, publicStoreCa, {name: 'proxy', configMap: {name: 'services-proxy'}},
        {name: 'proxy-key', secret: {secretName: 'services-proxy-key'}}, {name: 'mail', secret: {secretName: 'services-mail'}}],
      containers: [account, email, proxy, mailpit,
        service(image, 'monitor', 'packages/registration/src/monitor-cli.ts', {secret: 'services-monitor'}),
        service(image, 'usage', 'packages/registration/src/usage-reconcile-cli.ts --watch'),
        service(image, 'probe', 'packages/remote-access/src/probe-cli.ts')],
    }};
}

export function servicesDaemonSet(image, nodes, remoteCell) {
  const {metadata, spec} = servicesPod(image, undefined, true);
  spec.containers = spec.containers.filter(row => row.name !== 'mailpit');
  spec.volumes = spec.volumes.filter(row => row.name !== 'mail');
  const email = spec.containers.find(row => row.name === 'email');
  email.env.find(row => row.name === 'CLOUD_SMTP_HOST').value = outsideMailHost;
  email.env.push({name: 'CLOUD_SMTP_USER', valueFrom: {fieldRef: {fieldPath: 'spec.nodeName'}}});
  spec.containers.find(row => row.name === 'proxy').env.push(
    {name: 'TEST_CLOUD_ACCOUNT_NODE', valueFrom: {fieldRef: {fieldPath: 'spec.nodeName'}}});
  const labels = {app: metadata.name};
  // Each field selector accepts one node name, and Kubernetes matches any term.
  const terms = nodes.map(name => ({matchFields: [{key: 'metadata.name', operator: 'In', values: [name]}]}));
  const {containers: [inspect]} = servicesInspection(image, remoteCell).spec.template.spec;
  spec.containers.push(inspect);
  return {apiVersion: 'apps/v1', kind: 'DaemonSet', metadata, spec: {
    selector: {matchLabels: labels},
    template: {metadata: {labels}, spec: {...spec, restartPolicy: 'Always',
      affinity: {nodeAffinity: {requiredDuringSchedulingIgnoredDuringExecution: {nodeSelectorTerms: terms}}}}},
  }};
}

export function servicesVerifier(template, image, revision, nodeName) {
  const pod = structuredClone(template);
  pod.metadata.namespace = servicesNamespace;
  pod.spec.nodeName = nodeName;
  pod.spec.automountServiceAccountToken = false;
  pod.spec.securityContext = {...pod.spec.securityContext, fsGroup: 1000};
  delete pod.spec.hostAliases;
  const scratch = {name: 'verifier-scratch', mountPath: verifierScratchPath};
  pod.spec.volumes = [...pod.spec.volumes.filter(row => row.name !== 'config'), caVolume, publicStoreCa,
    {name: scratch.name, hostPath: {path: verifierScratchPath, type: 'Directory'}}];
  const daemon = pod.spec.containers.find(row => row.name === 'docker');
  daemon.volumeMounts.push(scratch);
  daemon.args.push('--group=1000');
  const worker = pod.spec.containers.find(row => row.name === 'verifier');
  // The capability-free worker must own scratch to clear it after the child exits.
  worker.securityContext = {...worker.securityContext, runAsUser: 1000, runAsGroup: 1000};
  const backup = service(image, 'verifier', 'packages/backups/src/worker-cli.ts', {
    storage: true, secret: 'services-backup', variables: {LOCAL_STACK_CONFIG_DIR: '/run/backup-verifier',
      CLOUD_VERIFIER_OWNER: 'waitron-cloud-test-backup', CLOUD_VERIFIER_IMAGE: '', CLOUD_VERIFIER_WAITRON_REVISION: revision,
      CLOUD_VERIFIER_SCRATCH_VOLUME: verifierScratchVolume},
    wait: 'until [ -f /run/backup-verifier/image-loaded ]; do sleep 1; done\n',
  });
  backup.env.push(...worker.env.filter(row => row.name === 'DOCKER_HOST'));
  backup.volumeMounts.push(...worker.volumeMounts.filter(row => row.name !== 'config'), scratch);
  Object.assign(worker, backup);
  return pod;
}

export function servicesInspection(image, remoteCell, nodeName) {
  return {apiVersion: 'batch/v1', kind: 'Job', metadata: {name: 'services-inspection', namespace: servicesNamespace},
    spec: {backoffLimit: 0, template: {spec: {restartPolicy: 'Never', ...(nodeName && {nodeName}),
      automountServiceAccountToken: false, volumes: [caVolume, publicStoreCa],
      containers: [service(image, 'inspect', `-e 'const timer = setInterval(() => {if (require("node:fs").existsSync("/tmp/inspection-complete")) clearInterval(timer)}, 250)'`, {
        storage: true, secret: 'services-backup', variables: remoteCell ? {CLOUD_STOCKHOLM_REMOTE_CELL: remoteCell} : {},
      })],
    }}}};
}
