import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {SignupStore,RegistrationStore} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {BackupCatalogue} from '../src/catalogue.ts';
import {BackupKeyVault} from '../src/keys.ts';
import {receipt} from '../src/storage.ts';
import {BackupWorker} from '../src/worker.ts';
import {createContainerWaitronVerifier} from '../src/container-verifier.ts';

test('database worker survives resource failures, preserves venue identity and verifies later work',async()=>{
 const owner='worker-'+randomUUID(),image='cloud-verifier-test:'+owner,root=fileURLToPath(new URL('../../../',import.meta.url)),docker=(...args:string[])=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,stdio:['pipe','pipe','pipe']}).trim();
 docker('build','-q','-t',image,'-f',join(root,'packages/backups/test/container-fixture/Dockerfile'),root);
 const db=await database(),scratch=await mkdtemp(join(tmpdir(),'container-worker-')),objects=new Map<string,Buffer>();
 try{
  const path=join(scratch,'source.db'),sqlite=new DatabaseSync(path);sqlite.exec('CREATE TABLE proof(value TEXT)');sqlite.close();const body=await readFile(path);
  const signup=new SignupStore(db.pool,db.outbox);await signup.request('container-worker@example.test');const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
  const account=await signup.complete(mail.token,{password:'A sufficiently long password',organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),registration=new RegistrationStore(db.pool);
  const catalogue=new BackupCatalogue(db.pool,new BackupKeyVault(randomBytes(32)),()=>({async read(key:string){return objects.get(key)!;},async put(key:string,value:Uint8Array){objects.set(key,Buffer.from(value));return receipt(value);},async remove(key:string){objects.delete(key);}}));
  const venues=[];
  for(let n=0;n<2;n++){
   const binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:account.organisationId,legalBusinessId:account.legalBusinessId};
   await registration.start(binding);await registration.approveCloud(binding,account.accountId);await registration.approveLocal(binding,randomUUID());const venue=await registration.complete(binding);venues.push(venue);
   await catalogue.provision(venue.installationId,{endpoint:'https://storage.test',bucket:'container-fixture-'+n,region:'local'});
  }
  const verify=await createContainerWaitronVerifier({image,owner,memoryMiB:192,scratchMiB:16}),worker=new BackupWorker(db.pool,catalogue,verify),ids=[];
  for(const [venueIndex,mode,identity] of [[0,1,1],[0,2,2],[1,5,5],[0,0,5],[0,0,0]]){
   const venue=venues[venueIndex!]!,capture=await catalogue.reserveCapture(venue.installationId,randomUUID()),bytes=Buffer.concat([Buffer.from([mode!]),body]);objects.set(capture.incomingKey,bytes);
   const point=await catalogue.publish(venue.installationId,capture.id,{...receipt(bytes),capturedAt:'2026-09-26T00:00:00.000Z',retention:'daily',sourceNodeId:'00000000-0000-4000-8000-'+String(identity).padStart(12,'0'),modules:{fake:1}});ids.push(point.id);
   await worker.schedule();await db.pool.query("UPDATE backup_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE target_id<>$1",[point.id]);
   assert.equal(await worker.runOnce(),true);
   const row=(await db.pool.query('SELECT verification FROM backup_points WHERE id=$1',[point.id])).rows[0];assert.equal(row.verification,mode===5||mode===0&&identity===0?'verified':'failed');
   assert.equal(docker('ps','-aq','--filter','label=cloud.backup-verifier.owner='+owner),'');
  }
  assert.deepEqual((await db.pool.query('SELECT venue_id,count(*)::int AS count FROM backup_points GROUP BY venue_id ORDER BY count')).rows,[{venue_id:venues[1]!.venueId,count:1},{venue_id:venues[0]!.venueId,count:4}]);
  assert.equal((await worker.status()).failures,3);
 }finally{await db.close();await rm(scratch,{recursive:true,force:true});const ids=docker('ps','-aq','--filter','label=cloud.backup-verifier.owner='+owner).split(/\s+/).filter(Boolean);if(ids.length)docker('rm','-f',...ids);docker('image','rm',image);}
});
