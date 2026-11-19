import {execFileSync, fork, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {rmSync, writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {kubernetesObject} from './kubernetes-object.mjs';

export const monotonicMs = () => Number(process.hrtime.bigint() / 1000000n);
const leaseActive = '/state/lease-active';
const supervisorPid = '/state/supervisor.pid';
const expiry = 15000, renewal = 5000, retry = 2000;

export async function runGatewayElection({lease, holder, grant, signal, now = monotonicMs,
  wait = ms => delay(ms, undefined, {signal})}) {
  let deadline, observedVersion, observedAt;
  while (!signal?.aborted && (deadline === undefined || now() < deadline)) {
    try {
      const current = await lease.get(signal), seen = now();
      if (current.metadata.resourceVersion !== observedVersion) {
        observedVersion = current.metadata.resourceVersion;
        observedAt = seen;
      }
      const incumbent = current.spec?.holderIdentity;
      if (deadline !== undefined && (seen >= deadline || incumbent !== holder)) return;
      // A standby measures an unchanged Lease on its own clock.
      if (!incumbent || incumbent === holder || seen - observedAt >= expiry) {
        const next = await lease.replace({...current, spec: {...current.spec,
          holderIdentity: holder, leaseDurationSeconds: expiry / 1000, renewTime: new Date().toISOString()}}, signal);
        if (signal?.aborted || next.spec.holderIdentity !== holder ||
          now() >= Math.min(deadline ?? Infinity, seen + renewal)) return;
        deadline = seen + renewal;
        grant(deadline);
      }
    } catch (error) {
      if (signal?.aborted) return;
      if (error.status === undefined && error.name !== 'TimeoutError' &&
        !['AbortError', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ETIMEDOUT'].includes(error.code)) throw error;
    }
    if (!signal?.aborted) await wait(retry);
  }
}

export async function watchGateway({channel = process, launch, unready = () => {}, withdraw, signal}) {
  let deadline, timer, child, exited;
  try {
    return await new Promise((resolve, reject) => {
      const update = next => {
        if (!Number.isSafeInteger(next)) return;
        const now = monotonicMs();
        if (now >= (deadline ?? next)) return stop();
        if (next <= (deadline ?? now)) return;
        deadline = next;
        clearTimeout(timer);
        timer = setTimeout(stop, deadline - now);
        if (child) return;
        try {
          child = launch();
          exited = once(child, 'exit');
          exited.then(() => stop('gateway-exited'), reject);
        } catch (error) {reject(error);}
      };
      function stop(reason) {
        clearTimeout(timer);
        channel.off('message', update);
        channel.off('disconnect', stop);
        signal?.removeEventListener('abort', stop);
        resolve(reason);
      }
      channel.on('message', update);
      channel.once('disconnect', stop);
      signal?.addEventListener('abort', stop, {once: true});
      if (signal?.aborted) stop();
    });
  } finally {
    clearTimeout(timer);
    unready();
    try {
      if (child?.pid) {
        try {process.kill(-child.pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}
        await exited;
      }
    } finally {withdraw();}
  }
}

async function run() {
  if (process.argv[2] === 'election') {
    const lease = kubernetesObject('/apis/coordination.k8s.io/v1/namespaces/d621-data/leases/remote-gateway');
    try {
      await runGatewayElection({lease, holder: process.env.HOSTNAME + ':' + randomUUID(), grant: deadline => process.send(deadline)});
    } finally {process.disconnect();}
    return;
  }
  const stop = new AbortController();
  process.once('SIGTERM', () => stop.abort());
  process.once('SIGINT', () => stop.abort());
  while (!stop.signal.aborted) {
    const election = fork(fileURLToPath(import.meta.url), ['election']);
    const ended = once(election, 'exit');
    writeFileSync(supervisorPid, String(election.pid), {mode: 0o600});
    const kill = () => election.kill('SIGKILL');
    stop.signal.addEventListener('abort', kill, {once: true});
    try {
      const reason = await watchGateway({channel: election, signal: stop.signal,
        launch() {
          const gateway = spawn(process.execPath, ['packages/remote-access/src/gateway-cli.ts'],
            {detached: true, stdio: 'inherit'});
          writeFileSync(leaseActive, '', {mode: 0o600});
          return gateway;
        },
        unready: () => rmSync(leaseActive, {force: true}),
        withdraw() {
          const run = args => execFileSync('ip', args, {stdio: 'ignore', timeout: 1000});
          try {run(['link', 'delete', 'wg-cloud']);}
          catch (error) {try {run(['link', 'show', 'wg-cloud']);} catch (missing) {if (missing.status === 1) return; throw missing;} throw error;}
        }});
      if (reason === 'gateway-exited') kill();
      await ended;
    } finally {
      stop.signal.removeEventListener('abort', kill);
      rmSync(supervisorPid, {force: true});
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {await run();} catch {console.error('remote.gateway_supervisor_failed'); process.exitCode = 1;}
}
