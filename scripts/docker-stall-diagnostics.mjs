import {execFileSync} from 'node:child_process';
import {freemem, loadavg, totalmem, uptime} from 'node:os';

// Probe only service responsiveness; daemon output can contain host configuration.
export function reportDockerInspectionStall({image, elapsedMs}) {
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
    daemon = {status: error.code === 'ETIMEDOUT' ? 'timeout' : 'refused'};
  }
  console.error('docker_stall=' + JSON.stringify({
    operation: 'image-inspect', image, error: 'ETIMEDOUT', elapsedMs, host, daemon,
  }));
}
