import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { measureRemoteJourneys } from './remote-journey.mjs';

const options = { staffHostname: 'staff.generated.example.test', publicHostname: 'generated.example.test',
  staffCa: readFileSync('/input/venue-ca.pem'), publicCa: readFileSync('/input/public-ca.pem'),
  email: 'owner@example.test', password: 'Generated local password' };
if (process.argv[2] === 'ready') {
  await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: 443, servername: options.staffHostname, ca: options.staffCa,
      agent: false, path: '/public/availability', headers: { host: options.staffHostname } }, res => {
      const parts = []; res.on('data', part => parts.push(part));
      res.on('end', () => { try { assert.equal(res.statusCode, 200); assert.equal(typeof JSON.parse(Buffer.concat(parts)).available, 'boolean'); resolve(); } catch (error) { reject(error); } });
    });
    req.on('error', reject); req.setTimeout(2000, () => req.destroy()); req.end();
  });
  process.stdout.write('{"ready":true}');
} else {
  if (process.argv[2] === 'extra-config') options.raw = 'private export canary';
  process.stdout.write(JSON.stringify(await measureRemoteJourneys(options)));
}
