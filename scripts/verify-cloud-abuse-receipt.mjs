import {readFile} from 'node:fs/promises';
import {verifyCloudAbuseReceipt} from '../packages/account-http/test/abuse-receipt.ts';

const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/verify-cloud-abuse-receipt.mjs <receipt.json>');
const receipt = verifyCloudAbuseReceipt(JSON.parse(await readFile(path, 'utf8')));
console.log(`Verified cloud abuse receipt from ${receipt.measuredAt}.`);
