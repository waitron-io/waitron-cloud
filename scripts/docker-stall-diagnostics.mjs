import {execFileSync} from 'node:child_process';
import {freemem, loadavg, totalmem, uptime} from 'node:os';

function probe(command, args, decode) {
  try {
    return decode(execFileSync(command, args, {
      encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 4096,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim());
  } catch (error) {
    return {status: error.code === 'ETIMEDOUT' ? 'timeout'
      : error.code === 'ENOBUFS' ? 'output-limit'
      : error.signal ? 'client-killed'
      : Number.isInteger(error.status) ? 'exit-error' : 'spawn-error'};
  }
}

const serviceStates = {
  Type: ['', 'simple', 'exec', 'forking', 'oneshot', 'dbus', 'notify', 'notify-reload', 'idle'],
  ActiveState: ['active', 'reloading', 'inactive', 'failed', 'activating', 'deactivating', 'maintenance', 'refreshing'],
  SubState: ['running', 'start', 'start-pre', 'start-post', 'auto-restart', 'dead', 'failed', 'listening', 'stop', 'stop-sigterm', 'stop-sigkill', 'stop-post', 'exited'],
  Result: ['success', 'resources', 'protocol', 'timeout', 'exit-code', 'signal', 'core-dump', 'watchdog', 'start-limit-hit', 'oom-kill', 'condition', 'assert'],
};
const serviceNumbers = ['MainPID', 'NRestarts', 'ExecMainStartTimestampMonotonic', 'ActiveEnterTimestampMonotonic'];
const unitNames = ['docker.service', 'containerd.service', 'docker.socket'];

function decodeServices(output) {
  const units = {};
  for (const block of output.split(/\n\s*\n/)) {
    const fields = Object.fromEntries(block.split('\n').map(line => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1)];
    }));
    if (!unitNames.includes(fields.Id)) continue;
    const unit = {};
    for (const [key, allowed] of Object.entries(serviceStates)) {
      if (allowed.includes(fields[key])) unit[key] = fields[key];
    }
    for (const key of serviceNumbers) {
      if (/^\d+$/.test(fields[key]) && Number.isSafeInteger(Number(fields[key]))) unit[key] = Number(fields[key]);
    }
    if (Object.keys(unit).length) units[fields.Id] = unit;
  }
  return Object.keys(units).length ? {status: 'reported', units} : {status: 'unrecognized'};
}

// Probe only service responsiveness; daemon output can contain host configuration.
export function reportDockerInspectionStall({image, elapsedMs}) {
  const observedMonotonicMs = Number(process.hrtime.bigint()) / 1e6;
  const host = {
    uptimeSeconds: uptime(), loadAverage: loadavg(),
    totalMemoryBytes: totalmem(), freeMemoryBytes: freemem(),
  };
  let daemon;
  try {
    const version = execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
      encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 2048,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    daemon = /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)
      ? {status: 'responsive', version} : {status: 'unrecognized'};
  } catch (error) {
    // A killed or missing client does not establish that the service refused a request.
    const status = error.code === 'ETIMEDOUT' ? 'timeout'
      : error.code === 'ENOBUFS' ? 'output-limit'
      : error.signal ? 'client-killed'
      : Number.isInteger(error.status) ? 'exit-error' : 'spawn-error';
    daemon = {status};
  }
  let hosted;
  if (process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted') {
    // Linux hrtime and systemd's microsecond timestamps share CLOCK_MONOTONIC.
    hosted = {observedMonotonicMs,
      service: probe('systemctl', ['show', '--property=Id,' + [...Object.keys(serviceStates), ...serviceNumbers].join(','), ...unitNames], decodeServices),
      socket: probe('curl', ['--silent', '--show-error', '--fail', '--max-time', '1', '--unix-socket', '/var/run/docker.sock', 'http://localhost/_ping'],
        output => ({status: output === 'OK' ? 'responsive' : 'unrecognized'})),
    };
  }
  console.error('docker_stall=' + JSON.stringify({
    operation: 'image-inspect', image, error: 'ETIMEDOUT', elapsedMs, host, daemon, ...hosted,
  }));
}
