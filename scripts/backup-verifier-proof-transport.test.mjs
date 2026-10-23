import assert from 'node:assert/strict';
import test from 'node:test';
import {deflateSync} from 'node:zlib';
import {randomBytes} from 'node:crypto';
import {jointReceipt} from './verify-backup-verifier-proof.test.mjs';
import {jointProofLine,readJointProofRun} from './backup-verifier-proof.mjs';
const counts='\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n';
const compressed=value=>'# CLOUD_BACKUP_JOINT_ZLIB='+deflateSync(Buffer.from(JSON.stringify(value))).toString('base64')+counts;
test('reads bounded compressed same-run evidence larger than a TAP stream chunk',()=>{
 const r=jointReceipt();assert(JSON.stringify(r).length>65536);assert.deepEqual(readJointProofRun(compressed(r)),r);
});
for(const [name,output] of [
 ['uncompressed and compressed receipts',()=>compressed(jointReceipt())+'# CLOUD_BACKUP_JOINT='+JSON.stringify(jointReceipt())+'\n'],
 ['two compressed receipts',()=>compressed(jointReceipt())+compressed(jointReceipt())],
 ['truncated compressed data',()=>compressed(jointReceipt()).replace(/(.{12})\n# tests/,'\n# tests')],
 ['noncanonical base64',()=>compressed(jointReceipt()).replace('ZLIB=','ZLIB= ')],
 ['unbounded compressed input',()=>'# CLOUD_BACKUP_JOINT_ZLIB='+Buffer.concat([deflateSync(Buffer.from(JSON.stringify(jointReceipt()))),randomBytes(20000)]).toString('base64')+counts],
 ['unbounded decompressed input',()=>'# CLOUD_BACKUP_JOINT_ZLIB='+deflateSync(Buffer.from(' '.repeat(2*1024*1024)+JSON.stringify(jointReceipt()))).toString('base64')+counts],
])test('refuses '+name,()=>assert.throws(()=>readJointProofRun(output())));
test('writer bounds the encoded proof before sending it through TAP',()=>{
 assert.throws(()=>jointProofLine({noise:randomBytes(20000).toString('hex')}),/output line bound/);
});
