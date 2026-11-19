import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {retryApi} from './kubernetes-node-loss.mjs';
import {separateByHost} from './kubernetes-placement.mjs';

const operatorImage = 'ghcr.io/cloudnative-pg/cloudnative-pg:1.29.2@sha256:4710b10a4897a4f888cbe80bce8b279475315590fb9f2cb0ebb516f2f40ebf06';
const postgresImage = 'ghcr.io/cloudnative-pg/postgresql:18.4-standard-trixie@sha256:ebf3919504d7523a63e8e2fee9b051211de714644b36469275558c624afd50ec';
const operatorManifest = 'https://github.com/cloudnative-pg/cloudnative-pg/releases/download/v1.29.2/cnpg-1.29.2.yaml';
const operatorDigest = '856312bb13e64c5b03861092eac9045e45f7b7d601aafe75a9016260a762ac8a';
const database = 'cloud-db';
const service = database + '-rw';
const client = 'cloud-db-client';
const reader = 'proofreader', writer = 'proofwriter';
const caPath = '/run/db-ca/ca.crt';
export const caVolume = {name: 'db-ca', secret: {secretName: database + '-ca', items: [{key: 'ca.crt', path: 'ca.crt'}]}};
const caMount = {name: caVolume.name, mountPath: '/run/db-ca', readOnly: true};

export async function installDatabaseOperator({directory, run, kube}) {
  const path = join(directory, 'operator.yaml');
  await run('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '90', '--output', path, operatorManifest],
    {timeout: 95_000});
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), operatorDigest, 'database_loss.operator_digest');
  const patch = {apiVersion: 'apps/v1', kind: 'Deployment', metadata: {name: 'cnpg-controller-manager', namespace: 'cnpg-system'},
    spec: {replicas: 2, template: {spec: {
      affinity: separateByHost({'app.kubernetes.io/name': 'cloudnative-pg'}),
      containers: [{name: 'manager', image: operatorImage, env: [{name: 'OPERATOR_IMAGE_NAME', value: operatorImage}]}]
    }}}};
  const configuration = {apiVersion: 'kustomize.config.k8s.io/v1beta1', kind: 'Kustomization', resources: ['operator.yaml'],
    patches: [{patch: JSON.stringify(patch)}]};
  await writeFile(join(directory, 'kustomization.yaml'), JSON.stringify(configuration));
  await kube(['apply', '--server-side', '-k', directory], {timeout: 120_000});
  await kube(['rollout', 'status', 'deployment/cnpg-controller-manager', '-n', 'cnpg-system', '--timeout=180s'], {timeout: 185_000});
}

const ref = (name, secret, key) => ({name, valueFrom: {secretKeyRef: {name: secret, key}}});
const value = (name, value) => ({name, value});

function managedRole(name, groupNames) {
  return {name, ensure: 'present', login: true, inRoles: groupNames, passwordSecret: {name}};
}

export function databaseCluster({storageClass = 'standard', proofRoles = true} = {}) {
  return {apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', metadata: {name: database},
    spec: {instances: 3, imageName: postgresImage, enableSuperuserAccess: false, failoverDelay: 0,
      switchoverDelay: 15, stopDelay: 20, storage: {size: '1Gi', storageClass},
      affinity: {enablePodAntiAffinity: true, topologyKey: 'kubernetes.io/hostname', podAntiAffinityType: 'required'},
      postgresql: {parameters: {synchronous_commit: 'on'}, synchronous: {method: 'any', number: 1, dataDurability: 'required', failoverQuorum: true}},
      ...(proofRoles && {managed: {roles: [managedRole(reader, ['pg_read_all_data']), managedRole(writer, [])]}})
    }};
}

function databaseSecret(name) {
  const password = randomBytes(24).toString('base64url');
  return {type: 'kubernetes.io/basic-auth', stringData: {username: name, password,
    uri: `postgresql://${name}:${password}@${service}:5432/app`}};
}

export function cloudContainer(image, name, secret, command) {
  return {name, image, imagePullPolicy: 'Never', workingDir: '/app', command,
    env: [ref('PGURI', secret, 'uri')], volumeMounts: [caMount]};
}

export const requireTls = `export DATABASE_URL="$PGURI?sslmode=verify-full&sslrootcert=${caPath}"\n`;
const probe = requireTls + `
until node --input-type=module -e '
  import {createRequire} from "node:module";
  import {checkConsumerSchema} from "./deploy/local-stack/runtime.mjs";

  const {Pool} = createRequire(new URL("./packages/registration/package.json", import.meta.url))("pg");
  const pool = new Pool({connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000});
  try {
    await checkConsumerSchema(pool, process.cwd());
    console.error("The schema gate accepted an unmigrated database");
    process.exitCode = 2;
  } catch (error) {
    const code = typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "unknown";
    console.error("Pre-migration schema read: " + code);
    process.exitCode = code === "42P01" ? 0 : 1;
  } finally {
    await pool.end();
  }
'; do
  if [ "$?" -eq 2 ]; then exit 2; fi
  sleep 1
done
touch /tmp/schema-waiting
until node deploy/local-stack/schema-consumer.mjs -e 'console.log("migration ledger verified")'; do sleep 1; done
touch /tmp/schema-ready
exec sleep infinity
`;

function clientPod(image, nodeName) {
  return {restartPolicy: 'Never', nodeName, automountServiceAccountToken: false, volumes: [caVolume], containers: [
    {...cloudContainer(image, 'schema', reader, ['sh', '-ec', probe]),
      readinessProbe: {exec: {command: ['test', '-f', '/tmp/schema-ready']}}},
    {name: 'writer', image: postgresImage, command: ['sleep', 'infinity'], volumeMounts: [caMount],
      env: [ref('PGPASSWORD', writer, 'password'), value('PGUSER', writer), value('PGDATABASE', 'app'),
        value('PGHOST', service), value('PGSSLMODE', 'verify-full'), value('PGSSLROOTCERT', caPath),
        value('PGCONNECT_TIMEOUT', '3'), value('PGOPTIONS', '-c statement_timeout=15000')]}
  ]};
}

export function migrationJob(image) {
  const container = cloudContainer(image, 'migrate', database + '-app', ['sh', '-ec',
    requireTls + 'exec node packages/registration/src/migrate-cli.ts']);
  return {backoffLimit: 0, activeDeadlineSeconds: 120, template: {spec: {restartPolicy: 'Never',
    automountServiceAccountToken: false, volumes: [caVolume], containers: [container]}}};
}

function within(signal, ms) {
  return {signal: AbortSignal.any([signal, AbortSignal.timeout(ms)]), timeout: ms + 2_000};
}

async function cleanUp(failure, action) {
  try {
    await action();
  } catch (error) {
    if (!failure) throw error;
    throw new AggregateError([failure, error], `${failure.message}\nCleanup failed: ${error.message}`);
  }
}

async function until(label, {signal}, check) {
  let failure;
  while (!signal.aborted) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      failure = error;
    }
    await delay(500, undefined, {signal}).catch(() => {});
  }
  throw Error('database_loss.' + label + (failure ? '\n' + failure.message : ''), {cause: failure});
}

export async function runKubernetesDatabase({nodes, directory, run, kube, stopNode, signal, image, cluster}) {
  const imageTag = cluster + ':cloud';
  const apply = (apiVersion, kind, name, body, options) =>
    kube(['create', '-f', '-'], {...options, input: JSON.stringify({apiVersion, kind, metadata: {name}, ...body})});
  const read = async (args, options) => JSON.parse(await kube(['get', ...args, '-o', 'json'], options));
  const exec = (pod, container, args, options) => kube(['exec', pod, '-c', container, '--', ...args], options);
  const local = (pod, sql, options) => exec(pod, 'postgres', ['psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'app', '-c', sql], options);
  const sql = (query, options, env = []) => exec(client, 'writer',
    ['env', ...env, 'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-c', query], options);
  const state = async options => (await read(['clusters.postgresql.cnpg.io', database], options)).status;
  const pods = async options => (await read(['pods', '-l', 'cnpg.io/cluster=' + database + ',cnpg.io/podRole=instance'], options)).items;
  const names = items => items.map(pod => pod.metadata.name).sort();
  const updateSenderTimeout = (setting, options) => kube(['patch', 'cluster', database, '--type=merge', '-p',
    JSON.stringify({spec: {postgresql: {parameters: {wal_sender_timeout: setting}}}})], options);
  const quorum = (primary, replicas, options) => until('failover_quorum', options, async () => {
    const {status} = await read(['failoverquorum', database], options);
    return status?.primary === primary && status.standbyNumber === 1 && status.method.toLowerCase() === 'any' &&
      names(replicas).every(name => status.standbyNames.includes(name)) && status.standbyNames.length === replicas.length;
  });
  const writeRow = name => `INSERT INTO failover_probe VALUES ('${name}') ON CONFLICT (marker) DO UPDATE SET marker=excluded.marker RETURNING marker`;
  const readRow = name => `SELECT marker FROM failover_probe WHERE marker = '${name}'`;
  async function verifyWrite(name, options) {
    // The marker is idempotent if the API connection drops after the database commits.
    const row = await retryApi(() => sql(writeRow(name), options), options.signal, name,
      error => /psql: error: could not translate host name .*Temporary failure in name resolution/.test(error.message));
    assert.equal(row, name, 'database_loss.written_row');
  }

  async function identities(instances, options) {
    assert.deepEqual(instances.map(pod => pod.spec.nodeName).sort(), [...nodes].sort(), 'database_loss.one_instance_per_node');
    const claims = await Promise.all(instances.map(async pod => {
      const claim = pod.spec.volumes.find(volume => volume.name === 'pgdata').persistentVolumeClaim.claimName;
      const volume = await read(['pvc', claim], options);
      assert.ok(volume.metadata.uid && volume.spec.volumeName, 'database_loss.bound_claim');
      return [pod.metadata.name, {node: pod.spec.nodeName, claim: volume.metadata.uid, volume: volume.spec.volumeName}];
    }));
    assert.equal(new Set(claims.map(([, claim]) => claim.volume)).size, 3, 'database_loss.separate_volumes');
    return Object.fromEntries(claims);
  }

  async function allReady(options) {
    return until('three_database_instances', options, async () => {
      const {currentPrimary, readyInstances} = await state(options);
      const instances = await pods(options);
      return readyInstances === 3 && instances.length === 3 && names(instances).includes(currentPrimary) &&
        {primary: instances.find(pod => pod.metadata.name === currentPrimary), replicas: instances.filter(pod => pod.metadata.name !== currentPrimary)};
    });
  }

  async function withPausedReceivers(replicas, action) {
    const paused = new Map();
    let failure;
    const resume = async (pod, options) => {
      if (!paused.has(pod)) return;
      await exec(pod, 'postgres', ['kill', '-CONT', paused.get(pod)], options);
      paused.delete(pod);
    };
    try {
      for (const {metadata: {name}} of replicas) {
        const pid = await local(name, 'SELECT pid FROM pg_stat_wal_receiver');
        assert.match(pid, /^[1-9][0-9]*$/, 'database_loss.receiver_pid');
        await exec(name, 'postgres', ['kill', '-STOP', pid]);
        paused.set(name, pid);
      }
      return await action(resume);
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      await cleanUp(failure, () => Promise.all([...paused.keys()].map(pod => resume(pod))));
    }
  }

  function observeCommit(name, options, syncOff = false) {
    let receipt;
    const query = syncOff ? 'SET synchronous_commit=off; ' + writeRow(name) : writeRow(name);
    const outcome = sql(query, options, ['PGAPPNAME=d621-commit']).then(row => {
      receipt = {row};
      return receipt;
    }, error => {
      receipt = {error};
      return receipt;
    });
    return {outcome, receipt: () => receipt};
  }

  let tagged = false, failure;
  try {
    const imageId = await run('docker', ['image', 'inspect', '--format={{.Id}}', image]);
    assert.equal(imageId, image, 'database_loss.local_image_binding');
    await run('docker', ['tag', image, imageTag]);
    tagged = true;
    await run('kind', ['load', 'docker-image', imageTag, '--name', cluster], {timeout: 180_000});
    await installDatabaseOperator({directory, run, kube});
    const started = within(signal, 360_000);
    for (const name of [reader, writer]) await apply('v1', 'Secret', name, databaseSecret(name));
    const {apiVersion, kind, metadata, spec} = databaseCluster();
    await apply(apiVersion, kind, metadata.name, {spec});
    const {primary, replicas} = await allReady(started);
    const oldPrimary = primary.metadata.name, primaryNode = primary.spec.nodeName;
    const originalClaims = await identities([primary, ...replicas], started);
    const clientNode = replicas[0].spec.nodeName;
    const standbyNode = replicas[1].spec.nodeName;
    await apply('v1', 'Pod', client, {spec: clientPod(imageTag, clientNode)});
    await until('consumer_refusal_before_migration', started, async () => {
      const pod = await read(['pod', client], started);
      assert.notEqual(pod.status.phase, 'Failed', 'database_loss.schema_probe_failed');
      await exec(client, 'schema', ['test', '-f', '/tmp/schema-waiting'], started);
      await exec(client, 'schema', ['test', '!', '-f', '/tmp/schema-ready'], started);
      return true;
    });
    const job = 'cloud-migrate-' + image.slice(7, 55);
    await apply('batch/v1', 'Job', job, {spec: migrationJob(imageTag)});
    await kube(['wait', '--for=condition=Complete', 'job/' + job, '--timeout=120s'], {timeout: 125_000});
    await kube(['wait', '--for=condition=Ready', 'pod/' + client, '--timeout=90s'], {timeout: 95_000});
    assert.equal(await sql('SELECT pg_is_in_recovery()', started), 'f', 'database_loss.writer_service_primary');
    await local(oldPrimary, 'CREATE TABLE failover_probe (marker text PRIMARY KEY); ' +
      'GRANT SELECT, INSERT, UPDATE ON failover_probe TO ' + writer, started);
    process.stderr.write('Migration completed and the surviving client read the release ledger\n');

    const baseSenderTimeout = await local(oldPrimary, 'SHOW wal_sender_timeout', started);
    await updateSenderTimeout('30s', started);
    await until('sender_timeout_extended', started, async () => (await local(oldPrimary, 'SHOW wal_sender_timeout', started)) === '30s');
    async function requirePending(commit, options) {
      return until('commit_waits_for_standby', options, async () => {
        const receipt = commit.receipt();
        if (receipt?.error) throw new assert.AssertionError({message: receipt.error.message});
        assert.ok(!receipt, 'database_loss.commit_returned_early');
        return (await local(oldPrimary, "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'd621-commit' AND wait_event = 'SyncRep'", options)) === '1';
      });
    }
    await withPausedReceivers(replicas, async () => {
      const syncOptions = within(signal, 20_000);
      const control = observeCommit('sync-off', syncOptions, true);
      await assert.rejects(requirePending(control, syncOptions), /database_loss\.commit_returned_early/);
      assert.equal((await control.outcome).row, 'sync-off', 'database_loss.sync_off_control');
    });
    await quorum(oldPrimary, replicas, started);
    process.stderr.write('Commit wait check rejected the synchronous-commit-off control\n');

    let promoted;
    const primaryFault = await withPausedReceivers(replicas, async resume => {
      const realCommitOptions = within(signal, 20_000);
      const commit = observeCommit('primary-loss', realCommitOptions);
      await requirePending(commit, realCommitOptions);
      await resume(replicas[0].metadata.name, realCommitOptions);
      const acknowledged = await commit.outcome;
      if (acknowledged.error) throw acknowledged.error;
      assert.equal(acknowledged.row, 'primary-loss', 'database_loss.commit_acknowledged');
      return stopNode(primaryNode, {
        async whileStopped(options) {
          await until('paused_receiver_resumed', options, async () => {
            await resume(replicas[1].metadata.name, options);
            return true;
          });
          promoted = await until('promoted_primary', options, async () => {
            const {currentPrimary} = await state(options);
            return currentPrimary && currentPrimary !== oldPrimary && (await sql('SELECT pg_is_in_recovery()', options)) === 'f' && currentPrimary;
          });
          assert.equal(await sql(readRow('primary-loss'), options), 'primary-loss', 'database_loss.acknowledged_row_preserved');
          await verifyWrite('promoted-write', options);
          process.stderr.write('Promoted PostgreSQL copy retained the acknowledged row and accepted a new write\n');
          return {acknowledgedRow: 'primary-loss', promoted};
        },
        async afterRestart(options) {
          const returning = await until('old_primary_replica', options, async () => {
            const endpoint = await read(['endpointslices', '-l', 'kubernetes.io/service-name=' + service], options);
            assert.ok(endpoint.items.every(slice => slice.endpoints.every(item => item.targetRef?.name !== oldPrimary)),
              'database_loss.old_primary_in_write_service');
            const pod = await read(['pod', oldPrimary], options);
            if (!pod.status?.podIP) return;
            const recovery = await local(oldPrimary, 'SELECT pg_is_in_recovery()', options);
            assert.equal(recovery, 't', 'database_loss.old_primary_still_writable');
            return pod;
          });
          const target = ['PGHOSTADDR=' + returning.status.podIP];
          await local(oldPrimary, 'SELECT pg_wal_replay_pause()', options);
          try {
            await verifyWrite('after-restart', options);
            await until('old_primary_replay_lag', options, async () =>
              (await local(oldPrimary, 'SELECT pg_last_wal_receive_lsn() > pg_last_wal_replay_lsn()', options)) === 't');
            assert.equal(await local(oldPrimary, readRow('after-restart'), options), '', 'database_loss.replay_barrier');
            await assert.rejects(sql(writeRow('refused'), options, target), /\b25006\b/, 'database_loss.old_primary_write_refusal');
          } finally {
            await local(oldPrimary, 'SELECT pg_wal_replay_resume()', options);
          }
          await until('old_primary_caught_up', options, async () => (await local(oldPrimary, readRow('after-restart'), options)) === 'after-restart');
          process.stderr.write('Former primary refused the write while behind and then replayed the new row\n');
        }
      });
    });

    const after = within(signal, 180_000);
    await updateSenderTimeout(null, after);
    await until('sender_timeout_restored', after, async () => (await local(promoted, 'SHOW wal_sender_timeout', after)) === baseSenderTimeout);
    const recovered = await allReady(after);
    assert.deepEqual(await identities([recovered.primary, ...recovered.replicas], after), originalClaims, 'database_loss.claim_identity');
    const next = recovered.replicas.find(pod => pod.spec.nodeName === standbyNode) ?? recovered.replicas.find(pod => pod.spec.nodeName === primaryNode);
    assert.ok(next && next.spec.nodeName !== clientNode, 'database_loss.standby_client_survives');
    const standbyFault = await stopNode(next.spec.nodeName, {async whileStopped(options) {
      await verifyWrite('standby-loss', options);
      assert.equal((await state(options)).currentPrimary, promoted, 'database_loss.standby_fault_primary_changed');
      return {acknowledgedRow: 'standby-loss'};
    }});
    const final = within(signal, 180_000);
    const ready = await allReady(final);
    assert.deepEqual(await identities([ready.primary, ...ready.replicas], final), originalClaims, 'database_loss.claim_identity');
    await until('standby_caught_up', final, async () => (await local(next.metadata.name, readRow('standby-loss'), final)) === 'standby-loss');
    return {clientNode, schema: {refusedBeforeMigration: true, readAfterMigration: true}, syncOffControl: true,
      primary: {...primaryFault, oldPrimaryWriteSqlstate: '25006'}, standby: standbyFault};
  } catch (error) {
    failure = error;
    for (const args of [['get', 'pods', '-A', '-o', 'wide'], ['get', 'clusters,failoverquorums', '-o', 'wide'],
      ['logs', '-l', 'cnpg.io/cluster=' + database + ',cnpg.io/podRole=instance', '-c', 'postgres', '--prefix', '--tail=15'],
      ['logs', '-n', 'cnpg-system', '-l', 'app.kubernetes.io/name=cloudnative-pg', '--prefix', '--tail=12'],
      ['logs', '-n', 'kube-system', '-l', 'k8s-app=kube-proxy', '--prefix', '--tail=12'],
      ['logs', 'job/cloud-migrate-' + image.slice(7, 55), '--tail=30'], ['logs', client, '-c', 'schema', '--tail=12']]) {
      const output = await kube(args, {signal: null}).catch(String);
      process.stderr.write(output.slice(-8192) + '\n');
    }
    throw error;
  } finally {
    if (tagged) await cleanUp(failure, () => run('docker', ['image', 'rm', imageTag], {signal: null}));
  }
}
