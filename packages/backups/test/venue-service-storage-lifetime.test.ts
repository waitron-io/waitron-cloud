import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {test} from 'node:test';
import {STSClient,AssumeRoleWithWebIdentityCommand} from '@aws-sdk/client-sts';
import {StorageAuthority} from '../src/storage.ts';

const now=Date.parse('2026-10-30T12:00:00.000Z');
const privateKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
const location={endpoint:'https://storage.test',region:'local',bucket:'venue-lifetime'};
const scopes={capture:'incoming/lifetime',stream:'streams/lifetime/',restore:'snapshots/lifetime'} as const;
function authority(){return new StorageAuthority({issuer:'https://issuer.test',audience:'storage',keyId:'lifetime',privateKey,roles:{capture:'arn:capture',stream:'arn:stream',restore:'arn:restore'}});}

// New policy refusals cannot revoke issued STS: keep the requested and accepted provider lifetime bounded.
for(const kind of ['capture','stream','restore'] as const)test('venue storage '+kind+' requests a fifteen minute temporary credential',async t=>{
 t.mock.timers.enable({apis:['Date'],now});
 t.mock.method(STSClient.prototype,'send',async(command:AssumeRoleWithWebIdentityCommand)=>{
  assert.ok(command instanceof AssumeRoleWithWebIdentityCommand);
  assert.equal(command.input.DurationSeconds,900);assert.equal(command.input.RoleArn,'arn:'+kind);assert.equal(command.input.RoleSessionName,'waitron-backup');
  const claims=JSON.parse(Buffer.from(command.input.WebIdentityToken!.split('.')[1]!,'base64url').toString());
  assert.equal(claims.kind,kind);assert.equal(claims.bucket,location.bucket);assert.equal(claims.scope,scopes[kind]);
  assert.equal(claims.exp-claims.iat,60);
  return {Credentials:{AccessKeyId:'temporary-access',SecretAccessKey:'temporary-secret',SessionToken:'temporary-token',Expiration:new Date(now+900000)}};
 });
 assert.deepEqual(await authority().grant(location,{kind,bucket:location.bucket,scope:scopes[kind]}),{credentials:{accessKeyId:'temporary-access',secretAccessKey:'temporary-secret',sessionToken:'temporary-token'},expiresAt:'2026-10-30T12:15:00.000Z'});
});
for(const offset of [0,901001])test('venue storage refuses temporary credential expiry offset '+offset,async t=>{
 t.mock.timers.enable({apis:['Date'],now});
 t.mock.method(STSClient.prototype,'send',async()=>({Credentials:{AccessKeyId:'temporary-access',SecretAccessKey:'temporary-secret',SessionToken:'temporary-token',Expiration:new Date(now+offset)}}));
 await assert.rejects(authority().grant(location,{kind:'capture',bucket:location.bucket,scope:scopes.capture}),/backup.storage_grant/);
});
test('venue storage accepts the existing one second provider expiry allowance',async t=>{
 t.mock.timers.enable({apis:['Date'],now});
 t.mock.method(STSClient.prototype,'send',async()=>({Credentials:{AccessKeyId:'temporary-access',SecretAccessKey:'temporary-secret',SessionToken:'temporary-token',Expiration:new Date(now+901000)}}));
 const grant=await authority().grant(location,{kind:'capture',bucket:location.bucket,scope:scopes.capture});assert.equal(grant.expiresAt,'2026-10-30T12:15:01.000Z');
});
