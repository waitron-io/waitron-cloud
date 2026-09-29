import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {crypto as acmeCrypto} from 'acme-client';
import {SignupStore,RegistrationStore,InstallationStore,createLeaseIssuer,encodeMachine,type MachineAction,type SignedEnvelope} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {createAccountApp} from '../../account-http/src/app.ts';
import {RemoteAccessStore} from '../src/placement.ts';
export async function staffExchangeFixture(staffCertificates=true){
 const db=await database(),origin='https://cloud.example.test',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 const app=createAccountApp({staffCertificates,pool:db.pool,outbox:db.outbox,leaseIssuer:issuer,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});
 const store=new RemoteAccessStore(db.pool),cellId=randomUUID();
 await store.createCell({id:cellId,country:'ES',provider:'aws',environment:'test',suffix:'exchange.example.test',subnet:52,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.example.test:51820'});
 async function venue(){
  const email=`certificate-${randomUUID()}@example.test`,signup=new SignupStore(db.pool,db.outbox);await signup.request(email);
  const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert('token' in mail);
  const owner=await signup.complete(mail.token,{password:'A long enough test password',organisationName:'Cafe Sol',legalBusinessName:'Cafe Sol SL',countryCode:'ES'});
  const key=generateKeyPairSync('ed25519'),binding={operationId:randomUUID(),installationKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  const registrations=new RegistrationStore(db.pool);await registrations.start(binding);await registrations.approveCloud(binding,owner.accountId);await registrations.approveLocal(binding,randomUUID());const installation=await registrations.complete(binding);
  const placement=await store.provision(installation.installationId,cellId,randomBytes(32).toString('base64'));
  function proof(action:string,body:unknown={},operationId=randomUUID(),lease?:SignedEnvelope,target=installation.installationId){const payload=encodeMachine({origin,action:action as MachineAction,installationId:target,operationId,issuedAt:Date.now(),lease:lease?JSON.stringify(lease):'',body:JSON.stringify(body)});return {payload:payload.toString('base64url'),signature:sign(null,payload,key.privateKey).toString('base64url')};}
  const lifecycle=await new InstallationStore(db.pool,issuer,origin).execute('renew',proof('renew'));
  const [privateKey,csr]=await acmeCrypto.createCsr({commonName:placement.staffHostname,altNames:[placement.staffHostname]});
  const body={version:1,hostname:placement.staffHostname,revision:lifecycle.revision,csr:csr.toString(),previousRequestId:null as string|null};
  return {...installation,placement,body,privateKey:privateKey.toString(),lease:lifecycle.lease!,proof};
 }
 async function request(action:string,envelope:unknown,headers:Record<string,string>={}){return app.request(origin+'/api/installations/'+action,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(envelope)},{incoming:{socket:{remoteAddress:'192.0.2.1'}}} as never);}
 return {db,app,origin,issuer,store,venue,request,close:()=>db.close()};
}
