import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {before,after,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {SignupStore,RegistrationStore} from '@waitron-cloud/registration';
import {Pool} from 'pg';
import {createServer} from 'node:net';
import {EmailOutbox} from '@waitron-cloud/registration';
import {migrate} from '../../registration/src/migrate.ts';
async function database(){
 const schema='outage_'+randomUUID().replaceAll('-',''),connectionString=process.env.TEST_DATABASE_URL;
 const admin=new Pool({connectionString,connectionTimeoutMillis:2000});admin.on('error',()=>{});
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString,options:'-c search_path='+schema,connectionTimeoutMillis:2000}),secondPool=new Pool({connectionString,options:'-c search_path='+schema,connectionTimeoutMillis:2000});
 await migrate(pool);
 return {pool,secondPool,outbox:new EmailOutbox({activeKeyId:'test',keys:{test:randomBytes(32).toString('hex')}}),async close(){await pool.end();await secondPool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
}
import {BackupCatalogue,type BackupPoint} from '../src/catalogue.ts';
import {BackupKeyVault} from '../src/keys.ts';
import {receipt} from '../src/storage.ts';
import {BackupWorker,type RestoreVerifier} from '../src/worker.ts';
import {createContainerWaitronVerifier} from '../src/container-verifier.ts';
import {buildFixtureImage} from './container-fixture/image.ts';

const owner='outage-'+randomUUID(),image='cloud-verifier-test:'+owner,postgres='cloud-postgres-'+owner;
const root=fileURLToPath(new URL('../../../',import.meta.url));
const docker=(...args:string[])=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,stdio:['pipe','pipe','pipe']}).trim();
let originalUrl:string|undefined,bytes:Buffer;
let imageBuilt=false,postgresStarted=false;
// The temporary initialization server accepts sockets before the TCP server starts.
async function ready(){for(let n=0;n<100;n++){try{docker('exec',postgres,'pg_isready','-h','127.0.0.1','-U','postgres');return;}catch{await delay(100);}}throw Error('PostgreSQL restart timed out');}
before(async()=>{
 originalUrl=process.env.TEST_DATABASE_URL;
 await buildFixtureImage(image,root);imageBuilt=true;
 const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()));
 const password=randomUUID();docker('run','-d','--name',postgres,'-p',`127.0.0.1:${port}:5432`,'-e','POSTGRES_PASSWORD='+password,'postgres:18-alpine');postgresStarted=true;
 await ready();process.env.TEST_DATABASE_URL=`postgres://postgres:${password}@127.0.0.1:${docker('port',postgres,'5432/tcp').split(':').at(-1)}/postgres`;
 const dir=await mkdtemp(join(tmpdir(),'outage-snapshot-'));
 try{const path=join(dir,'data.db'),db=new DatabaseSync(path);db.exec('CREATE TABLE proof(value TEXT)');db.close();bytes=await readFile(path);}finally{await rm(dir,{recursive:true,force:true});}
},{timeout:150000});
after(()=>{
 if(originalUrl===undefined)delete process.env.TEST_DATABASE_URL;else process.env.TEST_DATABASE_URL=originalUrl;
 const ids=docker('ps','-aq','--filter','label=cloud.backup-verifier.owner='+owner).split(/\s+/).filter(Boolean);if(ids.length)docker('rm','-f',...ids);
 if(postgresStarted)docker('rm','-f','-v',postgres);
 if(imageBuilt)docker('image','rm',image);
});
async function fixture(){
 const db=await database(),objects=new Map<string,Buffer>();
 // A real daemon shutdown emits errors on idle pool connections too.
 db.pool.on('error',()=>{});db.secondPool.on('error',()=>{});
 const signup=new SignupStore(db.pool,db.outbox),registration=new RegistrationStore(db.pool);
 const catalogue=new BackupCatalogue(db.pool,new BackupKeyVault(randomBytes(32)),()=>({async read(key:string){return objects.get(key)!;},async put(key:string,value:Uint8Array){objects.set(key,Buffer.from(value));return receipt(value);},async remove(key:string){objects.delete(key);}}));
 const points:BackupPoint[]=[];
 for(let n=0;n<2;n++){
  await signup.request(`outage-${n}@example.test`);const row=(await db.pool.query('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1')).rows[0],mail=db.outbox.open(row);assert('token' in mail);
  const account=await signup.complete(mail.token,{password:'A sufficiently long password',organisationName:'Sol '+n,legalBusinessName:'Sol SL '+n,countryCode:'ES'});
  const binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:account.organisationId,legalBusinessId:account.legalBusinessId};
  await registration.start(binding);await registration.approveCloud(binding,account.accountId);await registration.approveLocal(binding,randomUUID());const venue=await registration.complete(binding);
  await catalogue.provision(venue.installationId,{endpoint:'https://storage.test',bucket:'outage-fixture-'+n,region:'local'});
  const capture=await catalogue.reserveCapture(venue.installationId,randomUUID()),body=Buffer.concat([Buffer.from([n===0?0:4]),bytes]);objects.set(capture.incomingKey,body);
  points.push(await catalogue.publish(venue.installationId,capture.id,{...receipt(body),capturedAt:'2026-09-26T00:00:00.000Z',retention:'daily',sourceNodeId:'00000000-0000-4000-8000-000000000000',modules:{fake:1}}));
 }
 const verify=await createContainerWaitronVerifier({image,owner,memoryMiB:192,scratchMiB:16});
 const worker=(restore:RestoreVerifier=verify)=>new BackupWorker(db.pool,catalogue,restore);
 async function select(index=0){await worker().schedule();await db.pool.query("UPDATE backup_jobs SET available_at=CASE WHEN target_id=$1 THEN clock_timestamp() ELSE clock_timestamp()+interval '1 day' END",[points[index]!.id]);}
 async function state(index=0){return (await db.pool.query('SELECT verification FROM backup_points WHERE id=$1',[points[index]!.id])).rows[0].verification;}
 async function audit(){return (await db.pool.query('SELECT point_id,outcome FROM backup_verifications ORDER BY checked_at')).rows;}
 return {db,catalogue,points,verify,worker,select,state,audit};
}
test('PostgreSQL daemon outage leaves uncertainty unrecorded and lease recovery retries the same snapshot',{timeout:120000},async(t)=>{
 const f=await fixture();let stopped=false;
 try{
  await f.select();const start=Date.now();
  await assert.rejects(f.worker(async(...args)=>{await f.verify(...args);docker('stop','-t','0',postgres);stopped=true;}).runOnce());
  docker('start',postgres);await ready();stopped=false;
  assert.equal(await f.state(),'pending');assert.deepEqual(await f.audit(),[]);
  assert.equal((await f.db.pool.query("SELECT status FROM backup_jobs WHERE target_id=$1",[f.points[0]!.id])).rows[0].status,'running');
  await f.db.pool.query("UPDATE backup_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE status='running'");
  assert.equal(await f.worker().runOnce(),true);assert.equal(await f.state(),'verified');assert.equal(await f.state(1),'pending');
  assert.deepEqual(await f.audit(),[{point_id:f.points[0]!.id,outcome:'verified'}]);
  assert.equal((await f.db.pool.query('SELECT claim_id FROM backup_jobs WHERE target_id=$1',[f.points[0]!.id])).rows[0].claim_id,null);
  t.diagnostic('PostgreSQL stop/restart and same-snapshot retry: '+(Date.now()-start)+' ms');
 }finally{if(stopped){docker('start',postgres);await ready();}await f.db.close();}
});
test('Docker connection outage is retried without a failed-copy claim; malformed archive still fails',{timeout:120000},async()=>{
 const f=await fixture(),oldHost=process.env.DOCKER_HOST,oldContext=process.env.DOCKER_CONTEXT;
 try{
  await f.select();process.env.DOCKER_HOST='unix:///tmp/'+owner+'.missing.sock';delete process.env.DOCKER_CONTEXT;
  try{assert.equal(await f.worker().runOnce(),true);}finally{if(oldHost===undefined)delete process.env.DOCKER_HOST;else process.env.DOCKER_HOST=oldHost;if(oldContext!==undefined)process.env.DOCKER_CONTEXT=oldContext;}
  assert.equal(await f.state(),'pending');assert.deepEqual(await f.audit(),[]);
  const job=(await f.db.pool.query('SELECT status,last_error,claim_id,lease_until,attempts FROM backup_jobs WHERE target_id=$1',[f.points[0]!.id])).rows[0];
  assert.deepEqual(job,{status:'pending',last_error:'verification_unavailable',claim_id:null,lease_until:null,attempts:1});
  await f.select();assert.equal(await f.worker().runOnce(),true);assert.equal(await f.state(),'verified');assert.equal(await f.state(1),'pending');
  await f.select(1);assert.equal(await f.worker().runOnce(),true);assert.equal(await f.state(1),'failed');
  assert.deepEqual(await f.audit(),[{point_id:f.points[0]!.id,outcome:'verified'},{point_id:f.points[1]!.id,outcome:'failed'}]);
  assert.equal(docker('ps','-aq','--filter','label=cloud.backup-verifier.owner='+owner),'');
 }finally{await f.db.close();}
});
