import { MAX_OBJECT_BYTES } from '../packages/backups/src/object-transfer.ts';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { runCapacityFixture, preflight } from './backup-capacity-fixture.mjs';
import { verifyBackupTransferReceipt } from './verify-backup-transfer-receipt.mjs';
const sizes = [32,128,512].map(n => n * 1024 * 1024);
const receipt = {
  version:2,cloudHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  cloudDirty:Boolean(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()),
  profile:'controlled-tls-capacity',ceilingBytes:MAX_OBJECT_BYTES,
  environment:{platform:process.platform,arch:process.arch,node:process.version,samplingMs:20},fixtures:[],
  cleanup:null,
};
for (const bytes of sizes) {
  const {reason,...resources} = await preflight(bytes);
  if(reason) {receipt.fixtures.push({bytes,status:'skipped',reason,preflight:resources});console.error(`${bytes}: skipped (${reason})`);continue;}
  console.error(`${bytes}: starting two-venue TLS transfer`);
  const result=await runCapacityFixture(bytes);
  receipt.fixtures.push(result.fixture); receipt.cleanup=result.cleanup;
  console.error(`${bytes}: passed and cleaned`);
}
verifyBackupTransferReceipt(receipt);
await writeFile(process.argv[2] ?? '/tmp/cloud-backup-capacity-receipt.json',JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
