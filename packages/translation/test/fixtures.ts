import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {InstallationStore,RegistrationStore,SignupStore,encodeMachine,type LeaseIssuer,type MachineAction,type SignedEnvelope} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {jobFingerprint} from '../src/submit-proof.ts';
export {database};
export async function connectedVenue(db:Awaited<ReturnType<typeof database>>,issuer:LeaseIssuer,origin:string){
 const email=`translation-${randomUUID()}@example.test`,signup=new SignupStore(db.pool,db.outbox);await signup.request(email);
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert('token' in mail);
 const owner=await signup.complete(mail.token,{password:'A long enough test password',organisationName:'Cafe Sol',legalBusinessName:'Cafe Sol SL',countryCode:'ES'});
 const key=generateKeyPairSync('ed25519'),installationKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const binding={operationId:randomUUID(),installationKey,localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 const registrations=new RegistrationStore(db.pool);await registrations.start(binding);await registrations.approveCloud(binding,owner.accountId);await registrations.approveLocal(binding,randomUUID());
 const installation=await registrations.complete(binding);
 function proof(action:string,body:unknown={},operationId=randomUUID(),lease?:SignedEnvelope,raw?:string,issuedAt=Date.now()):SignedEnvelope{
  const payload=encodeMachine({origin,action:action as MachineAction,installationId:installation.installationId,operationId,issuedAt,lease:lease?JSON.stringify(lease):'',body:raw??JSON.stringify(body)});
  return {payload:payload.toString('base64url'),signature:sign(null,payload,key.privateKey).toString('base64url')};
 }
 const lease=(await new InstallationStore(db.pool,issuer,origin).execute('renew',proof('renew'))).lease!;
 const submit=(job:string,operationId=randomUUID(),issuedAt=Date.now())=>({...proof('translation-submit',undefined,operationId,lease,JSON.stringify({version:1,...jobFingerprint(job)}),issuedAt),body:job});
 return {...owner,...installation,installationKey,lease,proof,submit};
}
