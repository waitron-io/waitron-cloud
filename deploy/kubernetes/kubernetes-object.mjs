import {readFile} from 'node:fs/promises';
import {request} from 'node:https';

export function kubernetesObject(path) {
  const serviceAccount = '/var/run/secrets/kubernetes.io/serviceaccount/';
  const ca = readFile(serviceAccount + 'ca.crt');
  async function call(method, value, signal) {
    const payload = value === undefined ? undefined : JSON.stringify(value);
    const headers = {authorization: 'Bearer ' + (await readFile(serviceAccount + 'token', 'utf8')).trim(),
      ...(payload && {'content-type': 'application/json', 'content-length': Buffer.byteLength(payload)})};
    const root = await ca;
    return new Promise((resolve, reject) => {
      const req = request({hostname: 'kubernetes.default.svc', path, method, ca: root, headers,
        signal: AbortSignal.any([AbortSignal.timeout(3000), ...[signal].filter(Boolean)])}, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.once('error', reject);
        res.once('end', () => {
          if (res.statusCode !== 200) return reject(Object.assign(Error('remote.kubernetes_request'), {status: res.statusCode}));
          try {resolve(JSON.parse(Buffer.concat(chunks)));} catch (error) {reject(error);}
        });
      });
      req.once('error', reject);
      req.end(payload);
    });
  }
  return {get: signal => call('GET', undefined, signal), replace: (value, signal) => call('PUT', value, signal)};
}
