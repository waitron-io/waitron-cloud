import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {PairingCodes,pairingCodeKeysFromEnv} from '../src/pairing-codes.ts';
const config={activeKeyId:'v1',keys:{v1:'a'.repeat(64)}};
const row={id:'8a3da3a1-861b-46c3-b2d0-1af1025165aa',public_key:'public',local_venue_id:'8a3da3a1-861b-46c3-b2d0-1af1025165bb',environment:'test'};
test('each binding field and key participates in verification',()=>{
 const codes=new PairingCodes(config),stored=codes.protect(row,'12345678');
 assert.equal(codes.matches(row,stored,'12345678'),true);
 for(const change of [{id:row.local_venue_id},{public_key:'other'},{local_venue_id:row.id},{environment:'production'}])assert.equal(codes.matches({...row,...change},stored,'12345678'),false);
 assert.equal(new PairingCodes({activeKeyId:'v1',keys:{v1:'b'.repeat(64)}}).matches(row,stored,'12345678'),false);
 assert.throws(()=>new PairingCodes().matches(row,stored,'12345678'),/configuration unavailable/);
 assert.throws(()=>codes.matches(row,'a'.repeat(64),'12345678'),/configuration unavailable/);
});
test('configuration errors and CLI diagnostics never expose supplied secrets',()=>{
 for(const env of [{CLOUD_PAIRING_ACTIVE_KEY_ID:'v1'},{CLOUD_PAIRING_KEYS:'secret-that-must-not-be-logged'},{CLOUD_PAIRING_ACTIVE_KEY_ID:'private-key-id',CLOUD_PAIRING_KEYS:'{}'},{CLOUD_PAIRING_ACTIVE_KEY_ID:'v1',CLOUD_PAIRING_KEYS:JSON.stringify({v1:'private-short-key'})}]) {
  assert.throws(()=>pairingCodeKeysFromEnv(env),{message:'Pairing code configuration unavailable'});
  const result=spawnSync(process.execPath,['src/pairing-codes-cli.ts','--once'],{encoding:'utf8',env:{PATH:process.env.PATH,...env}});
  assert.equal(result.status,1);assert.equal(result.stdout,'');
  assert.equal(result.stderr.trim(),'Pairing code upgrade failed; check database, migrations and key configuration');
 }
 assert.equal(pairingCodeKeysFromEnv({}),undefined);
 assert.deepEqual(pairingCodeKeysFromEnv({CLOUD_PAIRING_ACTIVE_KEY_ID:'v1',CLOUD_PAIRING_KEYS:JSON.stringify(config.keys)}),config);
});
