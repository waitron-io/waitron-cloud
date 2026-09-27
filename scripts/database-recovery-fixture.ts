import {createRequire} from 'node:module';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {EmailOutbox,EmailWorker,RegistrationStore,SignupStore,transaction} from '../packages/registration/src/index.ts';

const require=createRequire(new URL('../packages/registration/package.json',import.meta.url));
const {Pool}=require('pg') as typeof import('pg');
const mode=process.argv[2],databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl||!['seed','claim'].includes(mode??''))throw new Error('database_recovery.fixture_configuration');
const email={activeKeyId:process.env.CLOUD_EMAIL_ACTIVE_KEY_ID??'',keys:JSON.parse(process.env.CLOUD_EMAIL_KEYS??'{}')};
const pool=new Pool({connectionString:databaseUrl,connectionTimeoutMillis:5000,statement_timeout:10000});
const outbox=new EmailOutbox(email);

async function account(address:string,name:string){
 const signup=new SignupStore(pool,outbox);await signup.request(address);
 const row=(await pool.query("SELECT * FROM email_outbox WHERE kind='verification' AND status='pending' ORDER BY created_at DESC LIMIT 1")).rows[0];
 if(!row)throw new Error('database_recovery.verification_missing');
 const message=outbox.open(row);if(!('token' in message))throw new Error('database_recovery.verification_invalid');
 return signup.complete(message.token,{password:`A sufficiently long ${name} recovery password`,organisationName:`${name} organisation`,legalBusinessName:`${name} SL`,countryCode:'ES'});
}

async function installation(owner:Awaited<ReturnType<typeof account>>){
 const key=generateKeyPairSync('ed25519'),binding={operationId:randomUUID(),installationKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test' as const,organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 const registration=new RegistrationStore(pool);await registration.start(binding);await registration.approveCloud(binding,owner.accountId);await registration.approveLocal(binding,randomUUID());
 return {...await registration.complete(binding),publicKey:binding.installationKey,privateKey:key.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')};
}

try{
 if(mode==='seed'){
  const first=await account('recovery-one@example.test','Recovery One'),second=await account('recovery-two@example.test','Recovery Two');
  await pool.query("DELETE FROM email_outbox WHERE kind='verification'");
  const messageId=await transaction(pool,client=>outbox.enqueue(client,'password_changed',{email:'recovery-one@example.test',locale:'en'}));
  process.stdout.write(JSON.stringify({installations:[await installation(first),await installation(second)],messageId}));
 }else{
  let announced=false;
  const blocked=async(_message:unknown,context:{deliveryId:string})=>{
   if(!announced){announced=true;process.stdout.write(`${JSON.stringify({claimed:context.deliveryId})}\n`);}
   return new Promise<never>(()=>{});
  };
  const worker=new EmailWorker(pool,outbox,{sendVerification:blocked,sendPasswordReset:blocked,sendPasswordChanged:blocked,sendServiceAlert:blocked});
  await worker.runOnce();
 }
}finally{await pool.end();}
