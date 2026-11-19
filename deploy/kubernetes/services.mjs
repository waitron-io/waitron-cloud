import {cloudContainer, caVolume, requireTls} from '../../scripts/kubernetes-database.mjs';

export const servicesNamespace = 'd621-data';
export const servicesOrigin = 'https://cloud.example.test:3000';
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

export function servicesPod(image, nodeName) {
  const mount = (name, mountPath) => ({name, mountPath, readOnly: true});
  const account = service(image, 'account', 'packages/account-http/src/server-cli.ts', {
    storage: true, secret: 'services-account', variables: {CLOUD_HTTP_HOST: '127.0.0.1',
      CLOUD_HTTP_TRUSTED_PROXY_IPS: '127.0.0.1', CLOUD_PORTAL_ORIGIN: servicesOrigin,
      CLOUD_COMPROMISED_PASSWORD_CORPUS: '/run/proxy/passwords.sha256'},
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
  const mailpit = {name: 'mailpit', image: 'axllent/mailpit:v1.31.1', args: [
    '--smtp', '127.0.0.1:1025', '--listen', '127.0.0.1:8025', '--smtp-require-tls',
    '--smtp-tls-cert', '/run/mail/tls.crt', '--smtp-tls-key', '/run/mail/tls.key',
    '--smtp-auth-file', '/run/mail/smtp-auth', '--ui-auth-file', '/run/mail/ui-auth',
    '--smtp-allowed-recipients', '^[^@]+@[^@]+\\.test$', '--smtp-disable-rdns',
  ], volumeMounts: [mount('mail', '/run/mail')]};
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

export function servicesVerifier(template, image) {
  const pod = structuredClone(template);
  pod.metadata.namespace = servicesNamespace;
  pod.spec.automountServiceAccountToken = false;
  delete pod.spec.hostAliases;
  pod.spec.volumes = [...pod.spec.volumes.filter(row => row.name !== 'config'), caVolume, publicStoreCa];
  const worker = pod.spec.containers.find(row => row.name === 'verifier');
  const backup = service(image, 'verifier', 'packages/backups/src/worker-cli.ts', {
    storage: true, secret: 'services-backup', variables: {LOCAL_STACK_CONFIG_DIR: '/run/backup-verifier',
      CLOUD_VERIFIER_OWNER: 'waitron-cloud-test-backup', CLOUD_VERIFIER_IMAGE: ''},
    wait: 'until [ -f /run/backup-verifier/image-loaded ]; do sleep 1; done\n',
  });
  backup.env.push(...worker.env.filter(row => row.name === 'DOCKER_HOST'));
  backup.volumeMounts.push(...worker.volumeMounts.filter(row => row.name !== 'config'));
  Object.assign(worker, backup);
  return pod;
}

export function servicesInspection(image) {
  return {apiVersion: 'batch/v1', kind: 'Job', metadata: {name: 'services-inspection', namespace: servicesNamespace},
    spec: {backoffLimit: 0, activeDeadlineSeconds: 900, template: {spec: {restartPolicy: 'Never',
      automountServiceAccountToken: false, volumes: [caVolume, publicStoreCa],
      containers: [service(image, 'inspect', `-e 'const timer = setInterval(() => {if (require("node:fs").existsSync("/tmp/inspection-complete")) clearInterval(timer)}, 250)'`, {
        storage: true, secret: 'services-account',
      })],
    }}}};
}
