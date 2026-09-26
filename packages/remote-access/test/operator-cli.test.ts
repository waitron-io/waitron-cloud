import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after,before,test} from 'node:test';
import {RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {RemoteAccessStore} from '../src/placement.ts';

const peerKey=()=>randomBytes(32).toString('base64');
let db:Awaited<ReturnType<typeof database>>,store:RemoteAccessStore,root:string,databaseUrl:string;

before(async()=>{
 db=await database();store=new RemoteAccessStore(db.pool);root=await mkdtemp(join(tmpdir(),'cloud-move-operator-'));
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options','-c search_path='+db.schema);databaseUrl=url.toString();
});
after(async()=>{await db?.close();await rm(root,{recursive:true,force:true});});

async function installation(){
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('operator-move@example.test');
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);
 const owner=await signup.complete(mail.token,{password:'a long enough test password',organisationName:'Cafés',legalBusinessName:'Cafés SL',countryCode:'ES'});
 const binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test' as const,organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 const registration=new RegistrationStore(db.pool);await registration.start(binding);await registration.approveCloud(binding,owner.accountId);await registration.approveLocal(binding,randomUUID());return registration.complete(binding);
}

async function operator(command:string,value:unknown){
 const file=join(root,randomUUID()+'.json');await writeFile(file,JSON.stringify(value),{mode:0o600});
 return spawnSync(process.execPath,['src/operator-cli.ts',command,file],{cwd:new URL('..',import.meta.url),encoding:'utf8',env:{...process.env,DATABASE_URL:databaseUrl}});
}

test('trusted commands fail closed and replay the durable completed move after a lost reply',async()=>{
 const source={id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:'operator-source.example.test',subnet:31,publicKey:peerKey(),endpoint:'operator-source-gateway.example.test:51820'};
 const target={id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:'operator-target.example.test',subnet:32,publicKey:peerKey(),endpoint:'operator-target-gateway.example.test:51820'};
 await store.createCell(source);await store.createCell(target);const installed=await installation(),active=await store.provision(installed.installationId,source.id,peerKey()),operationId=randomUUID();
 const staged=await operator('move-stage',{operationId,installationId:installed.installationId,targetCellId:target.id,targetPeerPublicKey:active.peerPublicKey,expectedRevision:1});
 assert.equal(staged.status,0,staged.stderr);assert.equal(JSON.parse(staged.stdout).state,'staged');
 const stale=await operator('move-ready',{operationId,expectedRevision:1,sequence:999});assert.equal(stale.status,1);assert.equal(stale.stdout,'');assert.equal(stale.stderr,'remote.command_failed\n');
 const sequence=(await store.manifest(target.id)).sequence,ready=await operator('move-ready',{operationId,expectedRevision:1,sequence});assert.equal(ready.status,0,ready.stderr);assert.equal(JSON.parse(ready.stdout).state,'ready');
 const completed=await operator('move-commit',{operationId,expectedRevision:1});assert.equal(completed.status,0,completed.stderr);assert.equal(JSON.parse(completed.stdout).state,'completed');
 const replay=await operator('move-commit',{operationId,expectedRevision:1});assert.equal(replay.status,0,replay.stderr);assert.deepEqual(JSON.parse(replay.stdout),JSON.parse(completed.stdout));
 const cancelCompleted=await operator('move-cancel',{operationId,expectedRevision:1});assert.equal(cancelCompleted.status,1);assert.equal(cancelCompleted.stderr,'remote.command_failed\n');
});
