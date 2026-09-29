import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
export const source=(root,path)=>import(pathToFileURL(join(root,path)).href);
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
export const digest=value=>createHash('sha256').update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value))))).digest('hex');
export async function seed(root,pool,email){
 const {SignupStore,EmailOutbox,RegistrationStore,transaction}=await source(root,'packages/registration/src/index.ts');
 const {PairingStore}=await source(root,'packages/registration/src/pairing.ts');
 const outbox=new EmailOutbox(email),installations=[];
 for(const name of ['one','two']){
  const signup=new SignupStore(pool,outbox);await signup.request(`upgrade-${name}@example.test`);
  const row=(await pool.query("SELECT * FROM email_outbox WHERE status='pending' ORDER BY created_at DESC LIMIT 1")).rows[0];
  const owner=await signup.complete(outbox.open(row).token,{password:`A sufficiently long ${name} upgrade password`,organisationName:`Upgrade ${name}`,legalBusinessName:`Upgrade ${name} SL`,countryCode:'ES'});
  const keys=generateKeyPairSync('ed25519');
  const binding={operationId:randomUUID(),installationKey:keys.publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  const store=new RegistrationStore(pool);await store.start(binding);await store.approveCloud(binding,owner.accountId);await store.approveLocal(binding,randomUUID());
  installations.push({...await store.complete(binding),binding,privateKey:keys.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')});
 }
 await pool.query('DELETE FROM email_outbox');
 const messageId=await transaction(pool,client=>outbox.enqueue(client,'password_changed',{email:'upgrade-one@example.test',locale:'en'}));
 const pending={origin:'https://cloud.example',action:'start',requestId:randomUUID(),publicKey:installations[0].binding.installationKey,localVenueId:randomUUID(),environment:'test',code:'12345678',organisationId:'',legalBusinessId:'',issuedAt:Date.now()};
 await new PairingStore(pool).start(pending);
 return{installations,messageId,pending};
}
export async function identity(pool){return(await pool.query('SELECT id,venue_id,public_key,revoked_at FROM installations ORDER BY id')).rows;}
export async function ledger(pool){return(await pool.query('SELECT name,digest FROM schema_migrations ORDER BY name')).rows;}
export async function completionRetry(root,pool,state){
 const {RegistrationStore}=await source(root,'packages/registration/src/index.ts');
 for(const installation of state.installations){const result=await new RegistrationStore(pool).complete(installation.binding);assert.equal(result.installationId,installation.installationId);assert.equal(result.venueId,installation.venueId);}
 return true;
}
