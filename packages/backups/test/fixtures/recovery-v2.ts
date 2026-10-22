import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {login} from '@waitron-cloud/identity';
import {SignupStore,RegistrationStore,transaction} from '@waitron-cloud/registration';
import type {database} from '../../../account-http/test/fixtures.ts';
import {BackupKeyVault} from '../../src/keys.ts';
import {BackupCatalogue} from '../../src/catalogue.ts';
import type {RecoveryMachineEnvelope} from '../../src/recovery-v2.ts';
import {BackupRecovery} from '../../src/recovery.ts';
import {RecoveryRequests} from '../../src/recovery-request.ts';
import {receipt} from '../../src/storage.ts';
import {setVerificationPolicy} from '../../src/verification-admission.ts';
import {fixtureTarget,fixtureImage,verifyPointFixture} from './verification.ts';
import {backupVerificationTargetDigests,type BackupVerificationTarget} from '../../src/verification-protocol.ts';
export const origin='https://cloud.test';
export function otherTarget(count=32):BackupVerificationTarget{
 const modules=Array.from({length:count},(_,i)=>({...fixtureTarget.modules[0],name:'owner-'+i,migrationTable:'__owner_'+i,requires:{},packageVersion:'1.2.3'}));
 const value={runtime:{...fixtureTarget.runtime,revision:'d'.repeat(40)},modules};
 return {version:1,...value,...backupVerificationTargetDigests(value)};
}
export function machineTarget(target:BackupVerificationTarget=fixtureTarget){
 const key=generateKeyPairSync('ed25519');
 return {id:randomUUID() as string,code:'12345678',publicKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),target,
  envelope(action:'start'|'status'|'info'|'read'|'restored',digest='',issuedAt=Date.now(),at=origin,version=2):RecoveryMachineEnvelope&{id?:string}{
   const request=action==='start'||action==='status';
   const values=request?[`waitron-cloud-recovery-request-v${version}`,at,this.id,action,this.publicKey,this.code]:[`waitron-cloud-recovery-v${version}`,at,this.id,action,digest];
   if(version===2)values.push(this.target.digest);values.push(issuedAt as never);
   const bytes=Buffer.from(JSON.stringify(values));
   const proof={...(!request?{id:this.id}:{}),payload:bytes.toString('base64url'),signature:sign(null,bytes,key.privateKey).toString('base64url')};
   return version===2?{...proof,version:2,target:this.target}:proof;
  }};
}
export async function recoveryFixture(db:Awaited<ReturnType<typeof database>>,qualified=true){
 const vault=new BackupKeyVault(randomBytes(32)),objects=new Map<string,Buffer>(),store={async read(k:string){return objects.get(k)!;},async put(k:string,b:Buffer){objects.set(k,Buffer.from(b));return receipt(b);},async remove(k:string){objects.delete(k);}};
 const catalogue=new BackupCatalogue(db.pool,vault,()=>store),email=randomUUID()+'@example.test',password='a long enough recovery password',signup=new SignupStore(db.pool,db.outbox);
 await signup.request(email);const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1')).rows[0]);if(!('token' in mail))throw Error('missing signup token');
 const owner=await signup.complete(mail.token,{password,organisationName:email,legalBusinessName:'Recovery SL',countryCode:'ES'}),session=await transaction(db.pool,c=>login(c,{email,password}));
 const reg=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:machineTarget().publicKey,localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await reg.start(binding);await reg.approveCloud(binding,owner.accountId);await reg.approveLocal(binding,randomUUID());const installed=await reg.complete(binding);
 await catalogue.provision(installed.installationId,{endpoint:'https://store.test',bucket:'recovery-'+randomUUID(),region:'local'});
 await transaction(db.pool,c=>setVerificationPolicy(c,fixtureTarget,fixtureImage,qualified));
 const capture=await catalogue.reserveCapture(installed.installationId,randomUUID()),bytes=Buffer.from('encrypted archive');objects.set(capture.incomingKey,bytes);
 const point=await catalogue.publish(installed.installationId,capture.id,{...receipt(bytes),capturedAt:new Date().toISOString(),retention:'daily',sourceNodeId:randomUUID(),modules:{core:1}});await verifyPointFixture(db.pool,catalogue,point.id);
 return {owner,session,installed,binding,point,capture,vault,objects,store,catalogue,recovery:new BackupRecovery(db.pool,vault,origin),requests:new RecoveryRequests(db.pool,vault,origin),input:{pointId:point.id,oldServerUnavailable:true,acceptDataLoss:true}};
}
