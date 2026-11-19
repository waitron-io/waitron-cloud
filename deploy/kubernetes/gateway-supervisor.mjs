import {execFileSync, fork, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {rmSync, writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {kubernetesObject} from './kubernetes-object.mjs';

export const monotonicMs = () => Number(process.hrtime.bigint() / 1000000n);
const leaseActive = '/state/lease-active';
const electionPid = '/state/election.pid';
const expiry = 15000, renewal = 5000, retry = 2000;

export async function runGatewayElection({lease, holder, grant, signal, now = monotonicMs,
  wait = ms => delay(ms, undefined, {signal}),
  onRefusal = status => console.error('remote.gateway_lease_refused:' + status)}) {
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
          holderIdentity: holder, leaseDurationSeconds: expiry / 1000,
          renewTime: new Date().toISOString().replace('Z', '000Z')}}, signal);
        if (signal?.aborted || next.spec.holderIdentity !== holder ||
          now() >= Math.min(deadline ?? Infinity, seen + renewal)) return;
        deadline = seen + renewal;
        grant(deadline);
      }
    } catch (error) {
      if (signal?.aborted) return;
      if (Number.isInteger(error.status)) {
        if (error.status !== 409 && error.status !== 429 && error.status < 500) onRefusal(error.status);
      } else if (!['AbortError', 'TimeoutError'].includes(error.name) &&
        !['ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT'].includes(error.code)) throw error;
    }
    if (!signal?.aborted) await wait(retry);
  }
}

export async function watchGateway({channel = process, launch, ready = () => {}, unready = () => {}, withdraw, signal}) {
  let deadline, timer, child, exited;
  try {
    await new Promise((resolve, reject) => {
      function finish(error) {
        clearTimeout(timer);
        channel.off('message', update);
        channel.off('disconnect', stop);
        signal?.removeEventListener('abort', stop);
        if (error) reject(error);
        else resolve();
      }
      const stop = () => finish();
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
          exited.then(stop, finish);
          ready();
        } catch (error) {finish(error);}
      };
      channel.on('message', update);
      channel.once('disconnect', stop);
      signal?.addEventListener('abort', stop, {once: true});
      if (signal?.aborted) stop();
    });
  } finally {
    try {unready();}
    finally {
      try {
        if (child?.pid) {
          try {process.kill(-child.pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}
          await exited;
        }
      } finally {withdraw();}
    }
  }
}

export async function superviseGatewayElection(election, {started = () => {}, ...watch}) {
  const ended = once(election, 'exit');
  try {
    started();
    await watchGateway({...watch, channel: election});
  } finally {
    // A stopped watchdog must never leave an election process renewing the lease.
    election.kill('SIGKILL');
    await ended;
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
    try {
      await superviseGatewayElection(election, {signal: stop.signal,
        started: () => writeFileSync(electionPid, String(election.pid), {mode: 0o600}),
        launch: () => spawn(process.execPath, ['packages/remote-access/src/gateway-cli.ts'], {detached: true, stdio: 'inherit'}),
        ready: () => writeFileSync(leaseActive, '', {mode: 0o600}),
        unready: () => rmSync(leaseActive, {force: true}),
        withdraw() {
          const run = args => execFileSync('ip', args, {stdio: 'ignore', timeout: 1000});
          try {run(['link', 'delete', 'wg-cloud']);}
          catch (error) {try {run(['link', 'show', 'wg-cloud']);} catch (missing) {if (missing.status === 1) return; throw missing;} throw error;}
        }});
    } finally {
      rmSync(electionPid, {force: true});
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {await run();} catch {console.error('remote.gateway_supervisor_failed'); process.exitCode = 1;}
}
