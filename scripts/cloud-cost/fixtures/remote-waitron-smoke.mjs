import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { measureRemoteJourneys } from './remote-journey.mjs';
import {readinessReply, readinessError} from './remote-readiness.mjs';

const options = { staffHostname: 'staff.generated.example.test', publicHostname: 'generated.example.test',
  staffCa: readFileSync('/input/venue-ca.pem'), publicCa: readFileSync('/input/public-ca.pem'),
  email: 'owner@example.test', password: 'Generated local password' };
if (process.argv[2] === 'ready') {
  const evidence = await new Promise(resolve => {
    const req = request({ host: '127.0.0.1', port: 443, servername: options.staffHostname, ca: options.staffCa,
      agent: false, path: '/public/availability', headers: { host: options.staffHostname } }, res => {
      const parts = []; res.on('data', part => parts.push(part));
      res.on('error', error => resolve(readinessError(error)));
      res.on('end', () => resolve(readinessReply(res.statusCode, Buffer.concat(parts))));
    });
    req.on('error', error => resolve(readinessError(error)));
    req.setTimeout(2000, () => req.destroy(Object.assign(new Error(), {code: 'ETIMEDOUT'}))); req.end();
  });
  process.stdout.write(JSON.stringify(evidence));
} else {
  if (process.argv[2] === 'extra-config') options.raw = 'private export canary';
  process.stdout.write(JSON.stringify(await measureRemoteJourneys(options)));
}
