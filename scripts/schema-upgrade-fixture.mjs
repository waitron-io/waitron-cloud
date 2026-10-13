import assert from 'node:assert/strict';
import {createHash,createHmac,generateKeyPairSync,randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
export const source=(root,path)=>import(pathToFileURL(join(root,path)).href);
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
export const digest=value=>createHash('sha256').update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value))))).digest('hex');
export async function seed(root,pool,email,pairing){
 const {SignupStore,EmailOutbox,RegistrationStore,transaction}=await source(root,'packages/registration/src/index.ts');
 const {PairingStore}=await source(root,'packages/registration/src/pairing.ts');
 const outbox=new EmailOutbox(email),installations=[],owners=[];
 for(const name of ['one','two']){
  const signup=new SignupStore(pool,outbox);await signup.request(`upgrade-${name}@example.test`);
  const row=(await pool.query("SELECT * FROM email_outbox WHERE status='pending' ORDER BY created_at DESC LIMIT 1")).rows[0];
  const owner=await signup.complete(outbox.open(row).token,{password:`A sufficiently long ${name} upgrade password`,organisationName:`Upgrade ${name}`,legalBusinessName:`Upgrade ${name} SL`,countryCode:'ES'});
  const password=`A sufficiently long ${name} upgrade password`;
  owners.push({...owner,email:`upgrade-${name}@example.test`,password});
  const keys=generateKeyPairSync('ed25519');
  const binding={operationId:randomUUID(),installationKey:keys.publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  const store=new RegistrationStore(pool);await store.start(binding);await store.approveCloud(binding,owner.accountId);await store.approveLocal(binding,randomUUID());
  installations.push({...await store.complete(binding),binding,privateKey:keys.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')});
 }
 await pool.query('DELETE FROM email_outbox');
 const messageId=await transaction(pool,client=>outbox.enqueue(client,'password_changed',{email:'upgrade-one@example.test',locale:'en'}));
 const pending={origin:'https://cloud.example',action:'start',requestId:randomUUID(),publicKey:installations[0].binding.installationKey,localVenueId:randomUUID(),environment:'test',code:'12345678',organisationId:'',legalBusinessId:'',issuedAt:Date.now()};
 await new PairingStore(pool,pairing).start(pending);
 return{installations,messageId,pending,owners};
}
export async function identity(pool){return(await pool.query('SELECT id,venue_id,public_key,revoked_at FROM installations ORDER BY id')).rows;}
export async function ledger(pool){return(await pool.query('SELECT name,digest FROM schema_migrations ORDER BY name')).rows;}
export async function completionRetry(root,pool,state){
 const {RegistrationStore}=await source(root,'packages/registration/src/index.ts');
 for(const installation of state.installations){const result=await new RegistrationStore(pool).complete(installation.binding);assert.equal(result.installationId,installation.installationId);assert.equal(result.venueId,installation.venueId);}
 return true;
}

export function upgradeRevisions(args){
 if(args.length===0)return{oldHead:'9a56d0122bf6872a0200735a7b1e3a23ad4f825c',newHead:'eafd97ad5ac51563e91c821d4c957ef996e5d3fb',factor:false};
 const values={};
 for(let i=0;i<args.length;i+=2){
  const name=args[i],value=args[i+1];
  if(!['--old','--new'].includes(name)||Object.hasOwn(values,name)||!(/^[0-9a-f]{40}$/).test(value??''))throw Error('schema upgrade revisions invalid');
  values[name]=value;
 }
 if(!values['--old']||!values['--new']||values['--old']===values['--new'])throw Error('schema upgrade revisions invalid');
 return{oldHead:values['--old'],newHead:values['--new'],factor:true};
}

export function factorCode(secret,now=Date.now()){
 const bits=[...secret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('');
 const bytes=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2))),step=Buffer.alloc(8);step.writeBigUInt64BE(BigInt(Math.floor(now/30000)));
 const mac=createHmac('sha1',bytes).update(step).digest();return((mac.readUInt32BE(mac[19]&15)&0x7fffffff)%1000000).toString().padStart(6,'0');
}
export async function seedAccountState(root,pool,state){
 const {login}=await source(root,'packages/identity/src/index.ts');
 const {transaction}=await source(root,'packages/registration/src/transaction.ts');
 for(const owner of state.owners){
  owner.credentials=await transaction(pool,c=>login(c,{email:owner.email,password:owner.password}));
  await pool.query('INSERT INTO cloud_passkey_users(account_id,user_handle) VALUES($1,$2)',[owner.accountId,randomBytes(32)]);
  await pool.query(`INSERT INTO cloud_passkeys(id,account_id,credential_id,public_key,counter,device_type,backed_up)
   VALUES($1,$2,$3,$4,1,'singleDevice',false)`,[randomUUID(),owner.accountId,randomBytes(32).toString('base64url'),randomBytes(32)]);
 }
}
export async function accountState(pool){
 const result={};for(const table of ['cloud_credentials','platform_permissions','cloud_sessions','cloud_passkey_users','cloud_passkeys'])result[table]=(await pool.query(`SELECT * FROM ${table} ORDER BY account_id`)).rows;
 return result;
}
export async function factorState(pool){
 const result={};for(const table of ['cloud_authenticator_factors','cloud_factor_enrolments','cloud_factor_login_challenges','cloud_factor_recovery_codes','cloud_factor_replays'])result[table]=(await pool.query(`SELECT * FROM ${table} ORDER BY account_id`)).rows;
 return result;
}
export async function enrolFactor(root,pool,state,keys){
 const {AuthenticatorFactorStore}=await source(root,'packages/registration/src/authenticator-factor.ts');
 const owner=state.owners[0],store=new AuthenticatorFactorStore(pool,keys,{pendingLifetimeMs:300000,enrolmentAttempts:10});
 const authority={...owner.credentials,password:owner.password},pending=await store.begin(authority);
 const changed=await store.activate(authority,pending.pendingToken,factorCode(pending.secret));
 assert.equal(changed.active,true);assert.equal(changed.recoveryCodes.length,10);
 assert.equal((await pool.query('SELECT count(*) FROM cloud_sessions WHERE account_id=$1 AND ended_at IS NULL',[owner.accountId])).rows[0].count,'0');
 return{owner,secret:pending.secret,codes:changed.recoveryCodes};
}
export async function restoredFactor(root,pool,proof,keys){
 const {PasswordLoginStore}=await source(root,'packages/registration/src/password-login.ts');
 const {decryptFactorSecret}=await source(root,'packages/identity/src/index.ts');
 const policy={loginLifetimeMs:300000,challengeAttempts:10},store=new PasswordLoginStore(pool,keys,policy);
 const login={email:proof.owner.email,password:proof.owner.password},challenge=await store.start(login);assert.equal(challenge.kind,'factor');
 const row=(await pool.query('SELECT * FROM cloud_authenticator_factors WHERE account_id=$1',[proof.owner.accountId])).rows[0];
 const binding={accountId:row.account_id,version:row.version,purpose:'active'};
 assert.equal(decryptFactorSecret(row.secret_envelope,keys,binding),proof.secret);
 assert.equal(decryptFactorSecret(row.secret_envelope,keys,{...binding,accountId:randomUUID()}),null);
 for(const config of [null,{activeKeyId:keys.activeKeyId,keys:{[keys.activeKeyId]:randomBytes(32).toString('hex')}}]){
  const broken=new PasswordLoginStore(pool,config,policy);
  for(const factorProof of [{kind:'totp',code:factorCode(proof.secret)},{kind:'recovery',code:proof.codes[0]}])await assert.rejects(broken.complete(challenge.challengeToken,factorProof),error=>error.code==='temporarily_unavailable');
 }
 const credentials=await store.complete(challenge.challengeToken,{kind:'recovery',code:proof.codes[0]});assert.equal(credentials.accountId,row.account_id);
 const again=await store.start(login);await assert.rejects(store.complete(again.challengeToken,{kind:'recovery',code:proof.codes[0]}),error=>error.code==='credentials_invalid');
 return true;
}
