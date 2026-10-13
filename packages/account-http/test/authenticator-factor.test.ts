import assert from 'node:assert/strict';
import {createHmac, generateKeyPairSync, randomBytes, randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {encryptFactorSecret, hashSecret} from '@waitron-cloud/identity';
import {PasswordLoginStore,createLeaseIssuer} from '@waitron-cloud/registration';
import {BackupKeyVault} from '@waitron-cloud/backups/keys';
import {recoveryCodeHash} from '../../registration/src/password-login.ts';
import {createAccountApp} from '../src/app.ts';
import * as configuration from '../src/config.ts';
import {database} from './fixtures.ts';

let db: Awaited<ReturnType<typeof database>>;
let app: ReturnType<typeof createAccountApp>;
const origin='https://cloud.example.test', password='A distinct account password';
const keys={activeKeyId:'factor',keys:{factor:'ab'.repeat(32)}};
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
const captures={vault:new BackupKeyVault(randomBytes(32)),objects:()=>{throw Error('Storage must require a session');},
  grant:async()=>{throw Error('Storage must require a session');}};
const policy={loginLifetimeMs:300000,pendingLifetimeMs:300000,challengeAttempts:10,enrolmentAttempts:10,
  loginAccount:{limit:100,windowSeconds:300},completeIp:{limit:100,windowSeconds:300},
  completeAccount:{limit:100,windowSeconds:300},completeChallenge:{limit:100,windowSeconds:300},
  manageIp:{limit:100,windowSeconds:300},manageAccount:{limit:100,windowSeconds:300}};
type FactorOptions={keys:typeof keys|null;policy:typeof policy|null};
function application(factor:FactorOptions={keys,policy},pool:Pool=db.pool) {
  return createAccountApp({pool,outbox:db.outbox,leaseIssuer:issuer,captures,
    config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},factor} as Parameters<typeof createAccountApp>[0]);
}
before(async()=>{db=await database();});
after(async()=>db?.close());
beforeEach(async()=>{await db.pool.query('TRUNCATE account_rate_limits, organisations, cloud_accounts CASCADE');app=application();});
function request(path:string,body?:unknown,options:{app?:typeof app;headers?:Record<string,string>;method?:string;peer?:string;raw?:string}={}) {
  const headers=new Headers({origin,'content-type':'application/json',...options.headers});
  return (options.app??app).request(`${origin}/api/account${path}`,{method:options.method??(body===undefined&&options.raw===undefined?'GET':'POST'),headers,
    ...(body===undefined&&options.raw===undefined?{}:{body:options.raw??JSON.stringify(body)})},
    {incoming:{socket:{remoteAddress:options.peer??'192.0.2.4'}}} as HttpBindings);
}
function cookies(response:Response) {
  const values=response.headers.getSetCookie().map(line=>line.split(';')[0]!);
  return {cookie:values.join('; '),'x-csrf-token':values.find(value=>value.startsWith('__Host-cloud_csrf='))!.split('=')[1]!};
}
async function account() {
  const accountId=randomUUID(),email=`owner-${accountId}@example.test`;
  await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[accountId]);
  await db.pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash) VALUES($1,$2,$3)',[accountId,email,await hashSecret(password)]);
  return {accountId,email};
}
async function activeAccount() {
  const owner=await account(),secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',generation=randomUUID();
  const envelope=encryptFactorSecret(secret,keys,{accountId:owner.accountId,version:1,purpose:'active'});
  await db.pool.query('INSERT INTO cloud_authenticator_factors(account_id,version,secret_generation,secret_envelope) VALUES($1,1,$2,$3)',[owner.accountId,generation,envelope]);
  const codes=Array.from({length:10},()=>randomBytes(16).toString('hex').toUpperCase());
  for(const code of codes)await db.pool.query('INSERT INTO cloud_factor_recovery_codes(account_id,factor_version,secret_generation,code_hash) VALUES($1,1,$2,$3)',[owner.accountId,generation,recoveryCodeHash(owner.accountId,1,code)]);
  return {...owner,secret,codes};
}
async function challenge(email:string,target=app,peer?:string) {
  const response=await request('/login',{email,password},{app:target,peer});
  assert.equal(response.status,202);assert.equal(response.headers.getSetCookie().length,0);
  const body=await response.json() as {factorRequired:boolean;challengeToken:string;expiresAt:string};
  assert.deepEqual(Object.keys(body).sort(),['challengeToken','expiresAt','factorRequired']);
  assert.equal(body.factorRequired,true);assert.match(body.challengeToken,/^[A-Za-z0-9_-]{43}$/);
  assert.ok(Date.parse(body.expiresAt)>Date.now());return body.challengeToken;
}
async function signIn(email:string) {
  const response=await request('/login',{email,password});assert.equal(response.status,200);return cookies(response);
}
function recovery(code:string) {return {kind:'recovery' as const,code};}
async function refusal(response:Response,status:number,error:string) {
  assert.equal(response.status,status);assert.deepEqual(await response.json(),{error});
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.getSetCookie().length,0);
}
function totp(secret:string,offsetSteps=0) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits=[...secret].map(ch=>alphabet.indexOf(ch).toString(2).padStart(5,'0')).join('');
  const decoded=Buffer.from(bits.match(/.{8}/g)!.map(byte=>parseInt(byte,2)));
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)+offsetSteps));
  const digest=createHmac('sha1',decoded).update(counter).digest(),offset=digest[19]!&15;
  return ((digest.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');
}
function count() {return db.pool.query('SELECT count(*)::integer AS count FROM cloud_sessions WHERE ended_at IS NULL').then(r=>r.rows[0].count);}

// Removing the login union or completion gate would create cookies/sessions before a valid second proof.
test('password login issues no session until exactly one concurrent factor completion succeeds',async()=>{
  const plain=await account();const full=await request('/login',{email:plain.email,password});
  assert.equal(full.status,200);assert.deepEqual(await full.json(),{accountId:plain.accountId});assert.equal(full.headers.getSetCookie().length,2);
  const owner=await activeAccount(),token=await challenge(owner.email);
  assert.equal(await count(),1);
  const second=application({keys,policy},db.secondPool);
  const replies=await Promise.all([app,second].map(target=>request('/login/factor',{challengeToken:token,proof:recovery(owner.codes[0]!)},{app:target})));
  assert.deepEqual(replies.map(r=>r.status).sort(),[200,401]);
  const success=replies.find(r=>r.status===200)!;
  assert.deepEqual(await success.json(),{accountId:owner.accountId});assert.equal(success.headers.getSetCookie().length,2);
  assert.ok(success.headers.getSetCookie().every(line=>/Secure/i.test(line)&&/SameSite=Lax/i.test(line)));
  assert.equal((await request('/session',undefined,{headers:cookies(success)})).status,200);
  await refusal(replies.find(r=>r.status===401)!,401,'credentials_invalid');assert.equal(await count(),2);
});

test('challenge tokens cannot access any session-backed route family',async()=>{
  const owner=await activeAccount(),token=await challenge(owner.email),headers={cookie:`__Host-cloud_session=${token}`,'x-csrf-token':token};
  const get=['/session','/sessions','/passkeys','/authenticator','/alerts','/installations','/pairing/businesses'];
  for(const path of get){const response=await request(path,undefined,{headers});assert.equal(response.status,401,path);assert.equal(response.headers.getSetCookie().length,0,path);}
  for(const [path,body] of [['/session/activity',{}],['/authenticator/begin',{password}],['/sessions/revoke',{id:randomUUID()}],
    ['/backups/list',{venueId:randomUUID()}],['/remote-access/status',{installationId:randomUUID()}],['/usage/read',{organisationId:randomUUID()}],
    ['/security-audit/read',{organisationId:randomUUID()}],['/diagnostics/read',{installationId:randomUUID()}],['/recovery/inspect',{}]] as const)
    assert.ok([401,403].includes((await request(path,body,{headers})).status),path);
  assert.equal(await count(),0);
});

for(const activationOffset of [0,-1])test('management activates once, returns codes once, revokes every session and clears cookies'+(activationOffset?' with previous-step enrolment':''),async()=>{
  const owner=await account(),headers=await signIn(owner.email),other=await signIn(owner.email);
  const status=await request('/authenticator',undefined,{headers});assert.equal(status.status,200);
  assert.deepEqual(await status.json(),{active:false,version:0,recoveryCodesRemaining:0,available:true});
  const begin=await request('/authenticator/begin',{password},{headers});assert.equal(begin.status,200);
  const pending=await begin.json() as {pendingToken:string;secret:string;uri:string;expiresAt:string};
  assert.deepEqual(Object.keys(pending).sort(),['expiresAt','pendingToken','secret','uri']);assert.match(pending.uri,/^otpauth:\/\/totp\//);
  // A previous-step fixture needs time to activate before that step leaves the accepted window.
  if(activationOffset){
    const now=(await db.pool.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime();
    if(now%30000>25000)await delay(30000-now%30000);
  }
  const activationCode=totp(pending.secret,activationOffset);
  const changed=await request('/authenticator/activate',{password,pendingToken:pending.pendingToken,code:activationCode},{headers});
  assert.equal(changed.status,200);const body=await changed.json() as {status:string;active:boolean;recoveryCodes:string[]};
  assert.deepEqual(Object.keys(body).sort(),['active','recoveryCodes','status']);assert.equal(body.status,'changed');assert.equal(body.active,true);
  assert.equal(body.recoveryCodes.length,10);assert.ok(body.recoveryCodes.every(c=>/^[A-F0-9]{32}$/.test(c)));
  assert.ok(changed.headers.getSetCookie().every(line=>/Max-Age=0/i.test(line)));assert.equal(changed.headers.getSetCookie().length,2);
  for(const session of [headers,other])assert.equal((await request('/session',undefined,{headers:session})).status,401);
  const token=await challenge(owner.email);
  await refusal(await request('/login/factor',{challengeToken:token,proof:{kind:'totp',code:activationCode}}),401,'credentials_invalid');
  const signed=await request('/login/factor',{challengeToken:token,proof:recovery(body.recoveryCodes[0]!)});assert.equal(signed.status,200);
  const live=cookies(signed),liveStatus=await request('/authenticator',undefined,{headers:live});
  assert.deepEqual(await liveStatus.json(),{active:true,version:1,recoveryCodesRemaining:9,available:true});
  const grouped=body.recoveryCodes[1]!.toLowerCase().match(/.{8}/g)!.join('-');
  const removed=await request('/authenticator/remove',{password,proof:recovery(grouped)},{headers:live});assert.equal(removed.status,200);
  assert.deepEqual(await removed.json(),{status:'changed',active:false});assert.equal(await count(),0);
  assert.equal((await request('/login',{email:owner.email,password})).status,200);
});

test('regeneration and cancellation enforce fresh authority without exposing codes from status',async()=>{
  const owner=await activeAccount(),direct=new PasswordLoginStore(db.pool,keys,policy);
  const credentials=await direct.complete(await challenge(owner.email),recovery(owner.codes[0]!));
  const headers={cookie:`__Host-cloud_session=${credentials.token}`,'x-csrf-token':credentials.csrfToken};
  await refusal(await request('/authenticator/regenerate',{password},{headers}),403,'credentials_invalid');
  await refusal(await request('/authenticator/regenerate',{password:'wrong',proof:recovery(owner.codes[1]!)},{headers}),403,'credentials_invalid');
  await refusal(await request('/authenticator/regenerate',{password,proof:recovery(owner.codes[1]!)},{headers:{...headers,'x-csrf-token':'wrong'}}),403,'credentials_invalid');
  const begun=await request('/authenticator/begin',{password,proof:recovery(owner.codes[1]!)},{headers});assert.equal(begun.status,200);
  const pending=await begun.json() as {pendingToken:string};
  await refusal(await request('/authenticator/activate',{password,proof:recovery(owner.codes[2]!),pendingToken:randomBytes(32).toString('base64url'),code:'123456'},{headers}),400,'invalid_input');
  const cancel=await request('/authenticator/cancel',{pendingToken:pending.pendingToken},{headers,app:application({keys:null,policy:null})});assert.equal(cancel.status,204);
  assert.equal((await request('/session',undefined,{headers})).status,200);
  const regenerated=await request('/authenticator/regenerate',{password,proof:recovery(owner.codes[2]!)},{headers});assert.equal(regenerated.status,200);
  const body=await regenerated.json() as {recoveryCodes:string[]};assert.equal(body.recoveryCodes.length,10);
  assert.equal(regenerated.headers.getSetCookie().length,2);assert.equal(await count(),0);
  const token=await challenge(owner.email);await refusal(await request('/login/factor',{challengeToken:token,proof:recovery(owner.codes[3]!)}),401,'credentials_invalid');
  assert.equal((await request('/login/factor',{challengeToken:token,proof:recovery(body.recoveryCodes[0]!)})).status,200);
});

test('nested proofs and management bodies reject extra keys, malformed types and overlong passwords',async()=>{
  const owner=await activeAccount(),token=await challenge(owner.email);
  for(const proof of [null,[],{kind:'totp',code:123456},{kind:'totp',code:'１２３４５６'},{kind:'totp',code:'123456',accountId:owner.accountId},
    {kind:'unknown',code:'123456'},{kind:'recovery',code:'a'.repeat(31)},{kind:'recovery',code:'a-'.repeat(16)}])
    await refusal(await request('/login/factor',{challengeToken:token,proof}),400,'invalid_input');
  await refusal(await request('/login/factor',{challengeToken:token,proof:recovery(owner.codes[0]!),accountId:owner.accountId}),400,'invalid_input');
  for(const challengeToken of [null,42,'short','a'.repeat(44),'!'.repeat(43)])
    await refusal(await request('/login/factor',{challengeToken,proof:recovery(owner.codes[0]!)}),400,'invalid_input');
  const plain=await account(),headers=await signIn(plain.email);
  for(const body of [{password,token},{password,csrfToken:token},{password,proof:{kind:'totp',code:'123456',extra:1}},
    {password:'é'.repeat(513)},{password:[]},{}])await refusal(await request('/authenticator/begin',body,{headers}),400,'invalid_input');
  assert.equal((await request('/authenticator/begin',{password},{headers:{...headers,origin:'https://evil.test'}})).status,403);
  assert.equal((await request('/authenticator?secret=oops',undefined,{headers})).status,400);
  assert.equal((await request('/authenticator/unknown',{},{headers})).status,404);
  assert.equal((await request('/authenticator/complete',{password},{headers})).status,404);
  assert.equal((await request('/authenticator',{}, {headers})).status,405);
  assert.equal((await request('/authenticator/begin',{password},{headers:{...headers,host:'evil.test'}})).status,403);
  assert.equal((await request('/authenticator/begin',{password},{headers:{...headers,'content-type':'text/plain'}})).status,415);
  assert.equal((await request('/authenticator/begin',undefined,{headers,raw:JSON.stringify({password:'x'.repeat(17000)})})).status,413);
  assert.equal((await request('/authenticator/begin',undefined,{headers,raw:'[]'})).status,400);
});

test('factor keys and policy outages preserve ordinary login and live access but refuse proof operations',async()=>{
  const plain=await account(),headers=await signIn(plain.email),owner=await activeAccount(),token=await challenge(owner.email);
  for(const factor of [{keys:null,policy},{keys,policy:null},{keys:{activeKeyId:'missing',keys:keys.keys},policy}]){
    const target=application(factor);
    assert.equal((await request('/login',{email:plain.email,password},{app:target})).status,200);
    assert.equal((await request('/session',undefined,{app:target,headers})).status,200);
    const status=await request('/authenticator',undefined,{app:target,headers});assert.equal(status.status,200);assert.equal((await status.json() as {available:boolean}).available,false);
    await refusal(await request('/login',{email:owner.email,password},{app:target}),503,'temporarily_unavailable');
    await refusal(await request('/login/factor',{challengeToken:token,proof:recovery(owner.codes[0]!)},{app:target}),503,'temporarily_unavailable');
    await refusal(await request('/authenticator/begin',{password},{app:target,headers}),503,'temporarily_unavailable');
  }
  assert.equal(await attempts('factor-login-account',owner.accountId),3,'verified issuance attempts survive key outages');
  assert.equal((await request('/login/factor',{challengeToken:token,proof:recovery(owner.codes[0]!)})).status,200);
});

test('unknown, stale, expired and exhausted challenges give one generic refusal with durable attempts',async()=>{
  const owner=await activeAccount(),token=await challenge(owner.email);
  await refusal(await request('/login/factor',{challengeToken:randomBytes(32).toString('base64url'),proof:recovery(owner.codes[0]!)}),401,'credentials_invalid');
  await refusal(await request('/login/factor',{challengeToken:token,proof:recovery('f'.repeat(32))}),401,'credentials_invalid');
  assert.equal((await db.pool.query('SELECT attempts FROM cloud_factor_login_challenges')).rows[0].attempts,1);
  await db.pool.query('UPDATE cloud_factor_login_challenges SET attempts=attempt_limit');
  await refusal(await request('/login/factor',{challengeToken:token,proof:recovery(owner.codes[0]!)}),401,'credentials_invalid');
  const expired=await challenge(owner.email);await db.pool.query('UPDATE cloud_factor_login_challenges SET expires_at=created_at+interval \'1 millisecond\'');
  await refusal(await request('/login/factor',{challengeToken:expired,proof:recovery(owner.codes[0]!)}),401,'credentials_invalid');
  const stale=await challenge(owner.email);await db.pool.query('UPDATE cloud_credentials SET password_hash=$1 WHERE account_id=$2',[await hashSecret('A different fresh password'),owner.accountId]);
  await refusal(await request('/login/factor',{challengeToken:stale,proof:recovery(owner.codes[0]!)}),401,'credentials_invalid');assert.equal(await count(),0);
});

function rateKey(scope:string,subject:string){return createHmac('sha256',Buffer.from(db.rateKey,'hex')).update(JSON.stringify([scope,subject])).digest('hex');}
async function attempts(scope:string,subject:string){return (await db.pool.query('SELECT attempts FROM account_rate_limits WHERE key=$1',[rateKey(scope,subject)])).rows[0]?.attempts??0;}

test('completion account budgets are shared across instances and challenges without consuming blocked proof',async()=>{
  const owner=await activeAccount(),tokens=await Promise.all([challenge(owner.email),challenge(owner.email)]);
  const bounded={...policy,completeAccount:{limit:1,windowSeconds:300}},first=application({keys,policy:bounded}),second=application({keys,policy:bounded},db.secondPool);
  await refusal(await request('/login/factor',{challengeToken:tokens[0],proof:recovery('f'.repeat(32))},{app:first}),401,'credentials_invalid');
  await refusal(await request('/login/factor',{challengeToken:tokens[1],proof:recovery(owner.codes[0]!)},{app:second,peer:'192.0.2.5'}),429,'rate_limited');
  assert.equal(await attempts('factor-complete-account',owner.accountId),2);assert.equal(await count(),0);
  assert.equal((await db.pool.query('SELECT count(*)::integer AS count FROM cloud_factor_recovery_codes WHERE consumed_at IS NOT NULL')).rows[0].count,0);
  const foreign=await activeAccount(),foreignToken=await challenge(foreign.email);
  assert.equal((await request('/login/factor',{challengeToken:foreignToken,proof:recovery(foreign.codes[0]!)},{app:second,peer:'192.0.2.6'})).status,200);
});

test('challenge completion limits survive changed IPs and unknown tokens use bounded opaque subjects',async()=>{
  const owner=await activeAccount(),token=await challenge(owner.email),bounded={...policy,completeChallenge:{limit:1,windowSeconds:300}};
  const first=application({keys,policy:bounded}),second=application({keys,policy:bounded},db.secondPool);
  await refusal(await request('/login/factor',{challengeToken:token,proof:recovery('f'.repeat(32))},{app:first}),401,'credentials_invalid');
  await refusal(await request('/login/factor',{challengeToken:token,proof:recovery(owner.codes[0]!)},{app:second,peer:'192.0.2.5'}),429,'rate_limited');
  assert.equal((await db.pool.query('SELECT attempts FROM cloud_factor_login_challenges')).rows[0].attempts,1);
  const unknown=randomBytes(32).toString('base64url');
  await refusal(await request('/login/factor',{challengeToken:unknown,proof:recovery('f'.repeat(32))},{app:first}),401,'credentials_invalid');
  const hash=(await import('node:crypto')).createHash('sha256').update(unknown).digest('hex');
  assert.equal(await attempts('factor-complete-account',`unknown:${hash}`),1);
  await refusal(await request('/login/factor',{challengeToken:unknown,proof:recovery('f'.repeat(32))},{app:second,peer:'192.0.2.6'}),429,'rate_limited');
  assert.ok((await db.pool.query('SELECT key FROM account_rate_limits')).rows.every(row=>/^[a-f0-9]{64}$/.test(row.key)));
  assert.equal(await count(),0);
});

test('IP-blocked completion and management requests never spend account or challenge budgets',async()=>{
  const owner=await activeAccount(),token=await challenge(owner.email);
  const bounded={...policy,completeIp:{limit:1,windowSeconds:300},manageIp:{limit:1,windowSeconds:300}},target=application({keys,policy:bounded});
  await refusal(await request('/login/factor',{challengeToken:randomBytes(32).toString('base64url'),proof:recovery('f'.repeat(32))},{app:target}),401,'credentials_invalid');
  await refusal(await request('/login/factor',{challengeToken:token,proof:recovery(owner.codes[0]!)},{app:target}),429,'rate_limited');
  assert.equal(await attempts('factor-complete-account',owner.accountId),0);assert.equal(await attempts('factor-complete-challenge',token),0);
  const plain=await account(),headers=await signIn(plain.email);
  await refusal(await request('/authenticator/begin',{password},{app:target}),403,'credentials_invalid');
  await refusal(await request('/authenticator/begin',{password},{app:target,headers}),429,'rate_limited');
  assert.equal(await attempts('factor-manage-account',plain.accountId),0);
});

test('management account limits survive new IPs and instances and refused passwords',async()=>{
  const owner=await account(),headers=await signIn(owner.email),bounded={...policy,manageAccount:{limit:1,windowSeconds:300}};
  await refusal(await request('/authenticator/begin',{password:'wrong'},{headers,app:application({keys,policy:bounded})}),403,'credentials_invalid');
  await refusal(await request('/authenticator/begin',{password},{headers,app:application({keys,policy:bounded},db.secondPool),peer:'192.0.2.5'}),429,'rate_limited');
  assert.equal((await db.pool.query('SELECT count(*)::integer AS count FROM cloud_factor_enrolments')).rows[0].count,0);
});

test('pre-password email and verified account issuance budgets cannot be reset by another instance',async()=>{
  const owner=await activeAccount(),bounded={...policy,loginAccount:{limit:1,windowSeconds:300}};
  const first=application({keys,policy:bounded}),second=application({keys,policy:bounded},db.secondPool);
  await refusal(await request('/login',{email:owner.email.toUpperCase(),password:'wrong'},{app:first}),401,'credentials_invalid');
  await refusal(await request('/login',{email:owner.email,password},{app:second,peer:'192.0.2.5'}),429,'rate_limited');
  assert.equal((await db.pool.query('SELECT count(*)::integer AS count FROM cloud_factor_login_challenges')).rows[0].count,0);
  assert.equal(await attempts('factor-login-account',owner.accountId),0);
  const unknown=`absent-${randomUUID()}@example.test`;
  await refusal(await request('/login',{email:unknown,password},{app:first,peer:'192.0.2.6'}),401,'credentials_invalid');
  await refusal(await request('/login',{email:unknown.toUpperCase(),password},{app:second,peer:'192.0.2.7'}),429,'rate_limited');
  await db.pool.query('TRUNCATE account_rate_limits');
  const token=await challenge(owner.email,first);
  assert.equal(await attempts('factor-login-account',owner.accountId),1);
  await db.pool.query('DELETE FROM account_rate_limits WHERE key=$1',[rateKey('factor-login-email',owner.email)]);
  await refusal(await request('/login',{email:owner.email,password},{app:second,peer:'192.0.2.5'}),429,'rate_limited');
  assert.equal((await db.pool.query('SELECT count(*)::integer AS count FROM cloud_factor_login_challenges')).rows[0].count,1);assert.ok(token);
});

test('verified issuance needs only one database connection and keeps refused account attempts durable',async()=>{
  const owner=await activeAccount(),single=new Pool({...db.pool.options,max:1,connectionTimeoutMillis:250});
  try {
    const bounded={...policy,loginAccount:{limit:1,windowSeconds:300}},target=application({keys,policy:bounded},single);
    await challenge(owner.email,target);
    await db.pool.query('DELETE FROM account_rate_limits WHERE key=$1',[rateKey('factor-login-email',owner.email)]);
    await refusal(await request('/login',{email:owner.email,password},{app:target,peer:'192.0.2.5'}),429,'rate_limited');
    assert.equal(await attempts('factor-login-account',owner.accountId),2);
    assert.equal((await db.pool.query('SELECT count(*)::integer AS count FROM cloud_factor_login_challenges')).rows[0].count,1);
  }finally{await single.end();}
});

test('expiry during challenge creation rolls back its effects but keeps the verified issuance attempt',async()=>{
  const owner=await activeAccount(),locker=await db.secondPool.connect(),target=application({keys,policy:{...policy,loginLifetimeMs:80}});
  let pending:Promise<Response>|undefined;
  try {
    await locker.query('BEGIN');await locker.query('LOCK TABLE cloud_factor_login_challenges IN SHARE MODE');
    pending=Promise.resolve(request('/login',{email:owner.email,password},{app:target}));
    const deadline=Date.now()+3000;
    while(!(await db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'INSERT INTO cloud_factor_login_challenges%'",[db.schema])).rowCount){
      assert.ok(Date.now()<deadline,'challenge insertion must wait on the held table lock');await delay(10);
    }
    await delay(100);await locker.query('COMMIT');
    await refusal(await pending,401,'credentials_invalid');
    assert.equal(await attempts('factor-login-account',owner.accountId),1);
    assert.equal((await db.pool.query('SELECT count(*)::integer AS count FROM cloud_factor_login_challenges')).rows[0].count,0);
    assert.equal(await count(),0);
  }finally{await locker.query('ROLLBACK');locker.release();await pending;}
});

test('factor configuration has strict independent keys and policy while bad input leaves the account server usable',async()=>{
  const parse=(configuration as unknown as {factorConfigFromEnv?:(env:NodeJS.ProcessEnv)=>FactorOptions}).factorConfigFromEnv;
  assert.equal(typeof parse,'function','factor configuration parser is required');
  const env={CLOUD_FACTOR_ACTIVE_KEY_ID:'factor',CLOUD_FACTOR_KEYS:JSON.stringify(keys.keys),CLOUD_FACTOR_POLICY:JSON.stringify(policy)};
  assert.deepEqual(parse!(env),{keys,policy});assert.deepEqual(parse!({CLOUD_EMAIL_ACTIVE_KEY_ID:'factor',CLOUD_EMAIL_KEYS:env.CLOUD_FACTOR_KEYS}),{keys:null,policy:null});
  for(const value of ['not-json','[]',JSON.stringify({...keys.keys,bad:'short'}),JSON.stringify({missing:'ab'.repeat(32)})])assert.equal(parse!({...env,CLOUD_FACTOR_KEYS:value}).keys,null);
  assert.equal(parse!({...env,CLOUD_FACTOR_ACTIVE_KEY_ID:'0',CLOUD_FACTOR_KEYS:JSON.stringify(['ab'.repeat(32)])}).keys,null);
  assert.equal(parse!({...env,CLOUD_FACTOR_ACTIVE_KEY_ID:'bad key id',CLOUD_FACTOR_KEYS:JSON.stringify({'bad key id':'ab'.repeat(32)})}).keys,null);
  for(const value of ['not-json','[]',JSON.stringify({...policy,extra:1}),JSON.stringify({...policy,completeIp:{limit:1,windowSeconds:1,extra:1}}),
    JSON.stringify({...policy,loginLifetimeMs:300001}),JSON.stringify({...policy,challengeAttempts:0}),JSON.stringify({...policy,enrolmentAttempts:1.5}),
    JSON.stringify({...policy,pendingLifetimeMs:'300000'}),JSON.stringify({...policy,manageAccount:{limit:0,windowSeconds:1}}),
    JSON.stringify({...policy,completeAccount:{limit:1000001,windowSeconds:1}}),JSON.stringify({...policy,completeIp:{limit:1,windowSeconds:86401}}),
    JSON.stringify({...policy,manageIp:{limit:1,windowSeconds:0}})])
    assert.equal(parse!({...env,CLOUD_FACTOR_POLICY:value}).policy,null);
  const invalid=parse!({...env,CLOUD_FACTOR_KEYS:'bad',CLOUD_FACTOR_POLICY:'bad'}),target=application(invalid),owner=await account();
  assert.equal((await request('/login',{email:owner.email,password},{app:target})).status,200);
});
