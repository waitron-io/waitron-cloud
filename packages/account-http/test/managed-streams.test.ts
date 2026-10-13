import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import assert from "node:assert/strict";
import {generateKeyPairSync,randomBytes,randomUUID,sign,type KeyObject} from "node:crypto";
import {after,before,beforeEach,test} from "node:test";
import type {HttpBindings} from "@hono/node-server";
import {createLeaseIssuer,encodeMachine,InstallationStore,RegistrationStore,SignupStore,type MachineAction,type SignedEnvelope} from "@waitron-cloud/registration";
import {BackupCatalogue} from "../../backups/src/catalogue.ts";
import {BackupKeyVault} from "../../backups/src/keys.ts";
import type {ManagedStreamAuthority,ManagedStreamProvision} from "../../backups/src/managed-streams.ts";
import type {StorageLocation,StorageScope} from "../../backups/src/storage.ts";
import {createAccountApp} from "../src/app.ts";
import {database} from "./fixtures.ts";

const origin="https://cloud.example.test",installationKey=generateKeyPairSync("ed25519"),otherInstallationKey=generateKeyPairSync("ed25519"),pointerKey=generateKeyPairSync("ed25519");
const issuer=createLeaseIssuer(generateKeyPairSync("ed25519").privateKey.export({type:"pkcs8",format:"der"}).toString("base64url"));
const vault=new BackupKeyVault(randomBytes(32)),objects=new Map<string,Buffer>(),provisions=new Map<string,ManagedStreamProvision>();
let db:Awaited<ReturnType<typeof database>>,installationId:string,venueId:string,localVenueId:string,otherInstallationId:string,lease:SignedEnvelope,app:ReturnType<typeof createAccountApp>,provisionHook:()=>Promise<void>;
const authority:ManagedStreamAuthority={
 async provision(input){await provisionHook();let result=provisions.get(input.venueId);if(!result){result={writerReference:`writer:${input.venueId}`,readerReference:`reader:${input.venueId}`,writerCredentials:{accessKeyId:`write-${input.venueId}`,secretAccessKey:"managed-writer-secret"}};provisions.set(input.venueId,result);}return result;},
 async read(reference,location,key){const value=objects.get(`${reference}:${location.bucket}:${key}`);if(!value)throw Error("NoSuchKey");return value;},
};
const captureOptions={
 vault,
 objects:(_location:StorageLocation)=>({async read(){throw Error("unused");},async put(){throw Error("unused");},async remove(){}}),
 async grant(_location:StorageLocation,_scope:StorageScope){throw Error("unused");},
 managedStreams:authority,
};
const config=()=>({portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]});
function resetApp(withAdapter=true){app=createAccountApp({pool:db.pool,outbox:db.outbox,config:config(),leaseIssuer:issuer,captures:withAdapter?captureOptions:{...captureOptions,managedStreams:undefined}} as Parameters<typeof createAccountApp>[0]);}
function proof(action:string,body:unknown,operationId=randomUUID(),currentLease=lease,target=installationId){const bytes=encodeMachine({origin,action:action as MachineAction,installationId:target,operationId,issuedAt:Date.now(),lease:JSON.stringify(currentLease),body:JSON.stringify(body)});return {payload:bytes.toString("base64url"),signature:sign(null,bytes,target===otherInstallationId?otherInstallationKey.privateKey:installationKey.privateKey).toString("base64url")};}
function request(action:string,body:unknown,headers:Record<string,string>={}){return app.request(`${origin}/api/installations/${action}`,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)},{incoming:{socket:{remoteAddress:"192.0.2.1"}}} as HttpBindings);}
async function renew(target=installationId){const key=target===otherInstallationId?otherInstallationKey:installationKey,bytes=encodeMachine({origin,action:"renew",installationId:target,operationId:randomUUID(),issuedAt:Date.now(),lease:"",body:"{}"});return (await new InstallationStore(db.pool,issuer,origin).execute("renew",{payload:bytes.toString("base64url"),signature:sign(null,bytes,key.privateKey).toString("base64url")})).lease!;}
function configuration(revision:number){return {revision,localVenueId,sourceNodeId:randomUUID(),pointerSignerPublicKey:pointerKey.publicKey.export({type:"spki",format:"der"}).toString("base64")};}
function signedPointer(nodeId:string,key:KeyObject){const body={venueId:localVenueId,term:3,nodeId,generation:`gen-3-${nodeId}-20260925T190000Z`,writtenAt:"2026-09-25T19:01:00.000Z"};const message=`{"pointer":{"generation":"${body.generation}","nodeId":"${body.nodeId}","term":3,"venueId":"${body.venueId}","writtenAt":"${body.writtenAt}"},"purpose":"waitron.stream.pointer.v1"}`;return Buffer.from(JSON.stringify({body,signature:sign(null,Buffer.from(message),key).toString("base64")}));}
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await resetSchema(db.pool);objects.clear();provisions.clear();provisionHook=async()=>{};
 const signup=new SignupStore(db.pool,db.outbox);await signup.request("managed-stream@example.test");const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox")).rows[0]);assert("token" in mail);
 const owner=await signup.complete(mail.token,{password:"A long enough managed stream password",organisationName:"Managed stream",legalBusinessName:"Managed stream SL",countryCode:"ES"}),registration=new RegistrationStore(db.pool),results=[];
 for(const key of [installationKey,otherInstallationKey]){const binding={operationId:randomUUID(),installationKey:key.publicKey.export({type:"spki",format:"der"}).toString("base64url"),localVenueId:randomUUID(),environment:"test",organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId} as const;await registration.start(binding);await registration.approveCloud(binding,owner.accountId);await registration.approveLocal(binding,randomUUID());results.push({...await registration.complete(binding),localVenueId:binding.localVenueId});}
 ({installationId,venueId,localVenueId}=results[0]!);otherInstallationId=results[1]!.installationId;
 const catalogue=new BackupCatalogue(db.pool,vault,captureOptions.objects);await catalogue.provision(installationId,{endpoint:"https://store.test",bucket:"managed-stream-one",region:"local"});await catalogue.provision(otherInstallationId,{endpoint:"https://store.test",bucket:"managed-stream-two",region:"local"});lease=await renew();resetApp();
});
test("signed configuration is exact, retryable and returns only Waitron writer material",async()=>{
 const revision=Number((await db.pool.query("SELECT configuration_revision FROM installations WHERE id=$1",[installationId])).rows[0].configuration_revision),desired=configuration(revision),operationId=randomUUID();
 const first=await request("backup-stream-configure",proof("backup-stream-configure",desired,operationId));assert.equal(first.status,200,await first.clone().text());assert.equal(first.headers.get("cache-control"),"no-store");const result=await first.json();
 assert.equal(result.configurationRevision,revision+1);assert.equal(result.bucket.accessKeyId,`write-${venueId}`);assert.match(result.recoveryKey,/^[A-Za-z0-9_-]{43}$/);for(const hidden of ["writerReference","readerReference",`writer:${venueId}`,`reader:${venueId}`])assert(!JSON.stringify(result).includes(hidden));
 assert.deepEqual(await(await request("backup-stream-configure",proof("backup-stream-configure",desired,operationId))).json(),result);
 assert.equal((await request("backup-stream-configure",proof("backup-stream-configure",{...desired,sourceNodeId:randomUUID()},operationId))).status,409);
 assert.equal((await request("backup-stream-configure",proof("backup-stream-configure",{...desired,extra:true}))).status,400);
 assert.equal((await request("backup-stream-configure",proof("backup-stream-configure",desired),{origin})).status,403);
 assert.equal((await request("backup-stream-configure",proof("backup-stream-observe",{}))).status,401);
});
test("managed-stream authority accepts an old live lease only during issuer-key overlap",async()=>{
 const next=createLeaseIssuer(generateKeyPairSync("ed25519").privateKey.export({type:"pkcs8",format:"der"}).toString("base64url")),trusted=new Map([[issuer.keyId,issuer.publicKey],[next.keyId,next.publicKey]]);
 const revision=Number((await db.pool.query("SELECT configuration_revision FROM installations WHERE id=$1",[installationId])).rows[0].configuration_revision);
 app=createAccountApp({pool:db.pool,outbox:db.outbox,config:config(),leaseIssuer:next,leaseTrust:trusted,captures:captureOptions});
 assert.equal((await request("backup-stream-configure",proof("backup-stream-configure",configuration(revision)))).status,200);
 app=createAccountApp({pool:db.pool,outbox:db.outbox,config:config(),leaseIssuer:next,captures:captureOptions});
 assert.equal((await request("backup-stream-observe",proof("backup-stream-observe",{}))).status,401);
});
test("observation reads and verifies storage itself while lease and revision mismatches fail closed",async()=>{
 const revision=Number((await db.pool.query("SELECT configuration_revision FROM installations WHERE id=$1",[installationId])).rows[0].configuration_revision),desired=configuration(revision),configured=await(await request("backup-stream-configure",proof("backup-stream-configure",desired))).json();
 objects.set(`reader:${venueId}:managed-stream-one:${configured.bucket.prefix}venues/${localVenueId}/current.json`,signedPointer(desired.sourceNodeId,pointerKey.privateKey));
 const response=await request("backup-stream-observe",proof("backup-stream-observe",{}));assert.equal(response.status,200,await response.clone().text());const observed=await response.json();assert.deepEqual({recoverableAt:observed.recoverableAt,sourceNodeId:observed.sourceNodeId},{recoverableAt:"2026-09-25T19:01:00.000Z",sourceNodeId:desired.sourceNodeId});for(const hidden of ["generation","readerReference","pointerSignerPublicKey","managed-writer-secret"])assert(!JSON.stringify(observed).includes(hidden));
 assert.equal((await request("backup-stream-observe",proof("backup-stream-observe",{result:"healthy"}))).status,400);
 const otherLease=await renew(otherInstallationId);assert.equal((await request("backup-stream-observe",proof("backup-stream-observe",{},randomUUID(),otherLease))).status,401);
 await db.pool.query("UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1",[installationId]);assert.equal((await request("backup-stream-observe",proof("backup-stream-observe",{}))).status,409);
});
test("provider waits recheck revocation and a missing adapter remains unavailable",async()=>{
 const revision=Number((await db.pool.query("SELECT configuration_revision FROM installations WHERE id=$1",[installationId])).rows[0].configuration_revision),desired=configuration(revision);provisionHook=async()=>{await db.secondPool.query("UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1",[installationId]);};
 const refused=await request("backup-stream-configure",proof("backup-stream-configure",desired));assert.equal(refused.status,403);assert(!JSON.stringify(await refused.json()).includes("managed-writer-secret"));assert.equal((await db.pool.query("SELECT count(*) FROM backup_managed_streams")).rows[0].count,"0");
 await db.pool.query("UPDATE installations SET revoked_at=NULL WHERE id=$1",[installationId]);resetApp(false);assert.equal((await request("backup-stream-configure",proof("backup-stream-configure",desired))).status,503);
});
test("missing storage and malformed provider grants are temporary failures",async()=>{
 const revision=Number((await db.pool.query("SELECT configuration_revision FROM installations WHERE id=$1",[installationId])).rows[0].configuration_revision),desired=configuration(revision);
 provisions.set(venueId,{writerReference:"",readerReference:`reader:${venueId}`,writerCredentials:{accessKeyId:"writer",secretAccessKey:"secret"}});
 assert.equal((await request("backup-stream-configure",proof("backup-stream-configure",desired))).status,503);
 provisions.delete(venueId);await db.pool.query("DELETE FROM backup_key_versions WHERE venue_id=$1",[venueId]);await db.pool.query("DELETE FROM backup_locations WHERE venue_id=$1",[venueId]);
 assert.equal((await request("backup-stream-configure",proof("backup-stream-configure",desired))).status,503);
});
test("a lease expiring during provider provisioning cannot commit or disclose credentials",async()=>{
 const revision=Number((await db.pool.query("SELECT configuration_revision FROM installations WHERE id=$1",[installationId])).rows[0].configuration_revision),desired=configuration(revision),values=JSON.parse(Buffer.from(lease.payload,"base64url").toString()),now=Date.now();
 const brief=issuer.issue({origin,leaseId:randomUUID(),installationId,venueId:values[5],environment:"test",publicKey:values[7],issuedAt:now,expiresAt:now+100});provisionHook=()=>new Promise(resolve=>setTimeout(resolve,150));
 const response=await request("backup-stream-configure",proof("backup-stream-configure",desired,randomUUID(),brief));assert.equal(response.status,401);assert(!JSON.stringify(await response.json()).includes("managed-writer-secret"));assert.equal((await db.pool.query("SELECT count(*) FROM backup_managed_streams")).rows[0].count,"0");
});
test("stream actions share the durable per-installation machine allowance",async()=>{
 const revision=Number((await db.pool.query("SELECT configuration_revision FROM installations WHERE id=$1",[installationId])).rows[0].configuration_revision),desired=configuration(revision);
 for(let count=0;count<30;count++){const response=await request("backup-stream-configure",proof("backup-stream-configure",desired));assert.equal(response.status,200,`request ${count+1}: ${await response.text()}`);resetApp();}
 const limited=await request("backup-stream-configure",proof("backup-stream-configure",desired));assert.equal(limited.status,429);assert.ok(Number(limited.headers.get("retry-after"))>0);
});
test("invalid stream proofs cannot bypass the durable per-IP allowance",async()=>{
 for(let count=0;count<60;count++){assert.equal((await request("backup-stream-observe",{})).status,400);resetApp();}
 const limited=await request("backup-stream-observe",{});assert.equal(limited.status,429);assert.ok(Number(limited.headers.get("retry-after"))>0);
});
