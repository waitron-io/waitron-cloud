import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {captureRuntime} from '../src/capture-config.ts';
test('capture configuration is opt-in and refuses partial settings',()=>{
 assert.equal(captureRuntime({}),undefined);
 assert.throws(()=>captureRuntime({CLOUD_BACKUP_MASTER_KEY:'broken'}));
});
test('runtime pins authority and object credentials to operator endpoint and region',async()=>{
 const runtime=configuredRuntime();
 try{const location={endpoint:'https://store.test',region:'local',bucket:'venue-one'};assert.equal(runtime.options.objects(location),runtime.options.objects(location));assert.throws(()=>runtime.options.objects({endpoint:'https://attacker.test',region:'local',bucket:'venue-one'}),/storage_configuration/);await assert.rejects(runtime.options.grant({endpoint:'https://attacker.test',region:'local',bucket:'venue-one'},{kind:'capture',scope:'incoming/test',bucket:'venue-one'}),/storage_configuration/);}finally{runtime.close();}
});

function configuredRuntime(){
 const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
 return captureRuntime({CLOUD_BACKUP_MASTER_KEY:randomBytes(32).toString('hex'),CLOUD_BACKUP_ENDPOINT:'https://store.test',CLOUD_BACKUP_REGION:'local',CLOUD_BACKUP_ACCESS_KEY:'operator',CLOUD_BACKUP_SECRET_KEY:'secret',CLOUD_BACKUP_AUTHORITY:JSON.stringify({issuer:'https://identity.test',audience:'backup',keyId:'test',privateKey:key,roles:{capture:'upload',stream:'stream',restore:'restore'}})})!;
}

test('the direct upload address signs only the reserved path and the create-only header',async()=>{
 const runtime=configuredRuntime();
 try{
  const location={endpoint:'https://store.test',region:'local',bucket:'venue-one'};
  assert.ok(runtime.options.signUpload,'configured storage must be able to sign a capture upload');
  const {uploadUrl,expiresAt}=await runtime.options.signUpload(location,'incoming/test');
  const url=new URL(uploadUrl),query=url.searchParams;
  assert.equal(url.origin,'https://store.test');
  assert.equal(url.pathname,'/venue-one/incoming/test');
  assert.equal(query.get('X-Amz-SignedHeaders'),'host;if-none-match');
  assert.equal(query.get('X-Amz-Expires'),'900');
  assert.equal(query.get('X-Amz-Credential')?.split('/')[0],'operator');
  assert.ok([...query.keys()].every(name=>!name.toLowerCase().includes('checksum')));
  assert.ok(Date.parse(expiresAt)>Date.now()&&Date.parse(expiresAt)<=Date.now()+900_000);
  await assert.rejects(runtime.options.signUpload({...location,endpoint:'https://different.test'},'incoming/test'),/storage_configuration/);
  await assert.rejects(runtime.options.signUpload({...location,region:'different'},'incoming/test'),/storage_configuration/);
  await assert.rejects(runtime.options.signUpload(location,'snapshots/test'),/storage_scope/);
 }finally{runtime.close();}
});
