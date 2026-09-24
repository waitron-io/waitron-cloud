import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {captureRuntime} from '../src/capture-config.ts';
test('capture configuration is opt-in and refuses partial settings',()=>{
 assert.equal(captureRuntime({}),undefined);
 assert.throws(()=>captureRuntime({CLOUD_BACKUP_MASTER_KEY:'broken'}));
});
test('runtime pins authority and object credentials to operator endpoint and region',async()=>{
 const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
 const runtime=captureRuntime({CLOUD_BACKUP_MASTER_KEY:randomBytes(32).toString('hex'),CLOUD_BACKUP_ENDPOINT:'https://store.test',CLOUD_BACKUP_REGION:'local',CLOUD_BACKUP_ACCESS_KEY:'operator',CLOUD_BACKUP_SECRET_KEY:'secret',CLOUD_BACKUP_AUTHORITY:JSON.stringify({issuer:'https://identity.test',audience:'backup',keyId:'test',privateKey:key,roles:{capture:'upload',stream:'stream',restore:'restore'}})})!;
 try{const location={endpoint:'https://store.test',region:'local',bucket:'venue-one'};assert.equal(runtime.options.objects(location),runtime.options.objects(location));assert.throws(()=>runtime.options.objects({endpoint:'https://attacker.test',region:'local',bucket:'venue-one'}),/storage_configuration/);await assert.rejects(runtime.options.grant({endpoint:'https://attacker.test',region:'local',bucket:'venue-one'},{kind:'capture',scope:'incoming/test',bucket:'venue-one'}),/storage_configuration/);}finally{runtime.close();}
});
