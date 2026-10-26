import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Pool} from 'pg';
import {IdentityError} from '@waitron-cloud/identity';
import {EmailOutbox} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {RemoteAccessStore} from '@waitron-cloud/remote-access/placement';
import {AccountRateLimiter} from '../src/rate-limit.ts';

// Inject identity failures at the allowance boundary to exercise public serialization, not authority.
for (const [cause, code] of [['permission_denied', 'permission_denied'], ['csrf_invalid', 'forbidden']] as const) {
  test(`HTTP keeps ${cause} distinct from the other 403 cause`, async t => {
    t.mock.method(AccountRateLimiter.prototype, 'consume', async () => {throw new IdentityError(cause);});
    const app = createAccountApp({pool: {} as Pool,
      outbox: new EmailOutbox({activeKeyId: 'test', keys: {test: 'ab'.repeat(32)}}),
      config: {portalOrigin: 'https://cloud.example.test', production: true, rateKey: 'cd'.repeat(32), trustedProxyIps: []},
      factor: {keys: null, policy: null}, pairingCodeKeys: null, recoveryCodeKeys: null});
    const response = await app.request('https://cloud.example.test/api/account/session', {},
      {incoming: {socket: {remoteAddress: '192.0.2.10'}}});
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {error: code});
    assert.deepEqual(response.headers.getSetCookie(), []);
    assert.equal(response.headers.get('retry-after'), null);
  });
}

// A controlled SQL boundary exercises the HTTP denial path; real locking remains a CI check.
for(const path of ['backups/list','diagnostics/read','diagnostics/read-final','remote-access/status','translation-consent','remote-access/dns']) {
  test(`${path}: ${path==='remote-access/dns'?'shared plan/setup refusal retains its response':'denied authority returns a permission response'} without exposing private data`, async t => {
    const {createHash}=await import('node:crypto');
    const id='20000000-0000-4000-8000-000000000001',token='a'.repeat(43),csrf='b'.repeat(43),now=new Date();
    const queries:string[]=[];
    const client={on(){},removeListener(){},release(){},async query(sql:string){
      queries.push(sql);
      if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[],rowCount:0};
      if(sql==='SELECT account_id FROM cloud_sessions WHERE token_hash = $1')return {rows:[{account_id:id}],rowCount:1};
      if(sql.startsWith('SELECT id FROM cloud_accounts'))return {rows:[{id}],rowCount:1};
      if(sql.startsWith('SELECT last_seen_at, absolute_expires_at, csrf_hash'))return {rows:[{last_seen_at:now,absolute_expires_at:new Date(+now+3600000),csrf_hash:createHash('sha256').update(csrf).digest('hex')}],rowCount:1};
      if(sql==='SELECT clock_timestamp() AS now')return {rows:[{now}],rowCount:1};
      if(path==='diagnostics/read-final'){
       if(sql.startsWith('SELECT i.id,i.venue_id'))return {rows:[{id,venue_id:id,environment:'test',configuration_revision:0,revoked_at:null,last_contact_at:null,lease_expires_at:null,generated_at:now}],rowCount:1};
       if(sql.startsWith('SELECT s.service')||sql.startsWith('SELECT kind,opened_at')||sql.startsWith('SELECT service.kind'))return {rows:[],rowCount:0};
       if(sql.startsWith('SELECT m.checked_at'))return {rows:[{enabled:false,fresh:false,checked_at:null}],rowCount:1};
       if(sql.startsWith('SELECT max(p.captured_at)'))return {rows:[{latest:null,verified:null}],rowCount:1};
      }
      if(path==='remote-access/dns'&&sql.includes('organisation_memberships'))return {rows:[{account_id:id}],rowCount:1};
      if(sql.includes('organisation_memberships')||sql.startsWith('SELECT account_id FROM cloud_credentials'))return {rows:[],rowCount:0};
      throw Error('Unexpected private-data query: '+sql);
    }};
    if(path==='remote-access/dns')t.mock.method(RemoteAccessStore.prototype,'hostnameInstructions',async()=>{throw Error('permission_denied');});
    t.mock.method(AccountRateLimiter.prototype,'consume',async()=>({allowed:true,retryAfterSeconds:0}));
    const app=createAccountApp({pool:{connect:async()=>client} as unknown as Pool,
      outbox:new EmailOutbox({activeKeyId:'test',keys:{test:'ab'.repeat(32)}}),
      config:{portalOrigin:'https://cloud.example.test',production:true,rateKey:'cd'.repeat(32),trustedProxyIps:[]},
      factor:{keys:null,policy:null},pairingCodeKeys:null,recoveryCodeKeys:null});
    const body=path==='translation-consent'?{venueId:id,choice:'agree',consentVersion:'providers-2026-10-14'}:path==='backups/list'?{venueId:id}:path==='remote-access/dns'?{installationId:id,kind:'staff',hostname:'staff.example.test'}:{installationId:id};
    const response=await app.request('https://cloud.example.test/api/account/'+path.replace('-final',''),{method:'POST',headers:{origin:'https://cloud.example.test','content-type':'application/json',cookie:'__Host-cloud_session='+token,'x-csrf-token':csrf},body:JSON.stringify(body)},{incoming:{socket:{remoteAddress:'192.0.2.10'}}});
    assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:path==='remote-access/dns'?'forbidden':'permission_denied'});
    assert(queries.includes(path==='remote-access/dns'?'COMMIT':'ROLLBACK'));assert.equal(queries.some(sql=>/^INSERT|^UPDATE|^DELETE/.test(sql)),false);
  });
}
