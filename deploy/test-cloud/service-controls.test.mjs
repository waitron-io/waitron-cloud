import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootstrap} from '../local-stack/bootstrap.mjs';
import {createSession} from '../../packages/identity/src/index.ts';
import {createLeaseIssuer,InstallationStore,transaction} from '../../packages/registration/src/index.ts';
import {RelayControl} from '../../packages/registration/src/relay-control.ts';
import {readGuestMenu} from '../../packages/remote-access/src/guest-menu.ts';
import {connectedVenue,database} from '../../packages/translation/test/fixtures.ts';

const origin='https://cloud.example.test';
const environment={CLOUD_VENUE_SERVICE_LEVELS:'test',CLOUD_TEST_SERVICE_PLANS:'0'};
async function controls(){
 const api=await import('./service-controls.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
 assert.equal(typeof api.executeTestServiceCommand,'function','test Cloud needs the local service command');
 return api.executeTestServiceCommand;
}

test('owner menu switch withdraws published pages and requires a fresh publication after enabling',async()=>{
 const run=await controls(),db=await database();
 try{
  const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const box=await connectedVenue(db,issuer,origin),context={pool:db.pool,issuer,origin,environment};
  await db.pool.query(`INSERT INTO guest_menus(venue_id,revision,state,source_installation_id,body_sha256,default_language,received_at,pages)
   VALUES($1,1,'current',$2,$3,'en',clock_timestamp(),$4)`,[box.venueId,box.installationId,'a'.repeat(64),{en:'<p>Cafe menu</p>'}]);
  assert.equal((await readGuestMenu(db.pool,box.venueId)).html,'<p>Cafe menu</p>');
  assert.equal((await run(context,{command:'guest-menu',venueId:box.venueId,enabled:false})).state,'blocked');
  assert.equal(await readGuestMenu(db.pool,box.venueId),null);
  assert.equal((await run(context,{command:'guest-menu',venueId:box.venueId,enabled:true})).state,'off');
  assert.equal(await readGuestMenu(db.pool,box.venueId),null);
  await db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[box.venueId]);
  await assert.rejects(run(context,{command:'guest-menu',venueId:box.venueId,enabled:false}),/test_cloud.service_target/);
  assert.equal((await db.pool.query('SELECT state FROM guest_menus WHERE venue_id=$1',[box.venueId])).rows[0].state,'off');
 }finally{await db.close();}
});

test('relay stop and resume use the sending control and refuse outside explicit test mode',async()=>{
 const run=await controls(),db=await database();
 try{
  const context={pool:db.pool,origin,environment},control=new RelayControl(db.pool);
  assert.deepEqual(await run(context,{command:'relay-stop'}),{stopped:true});
  assert.deepEqual(await control.status(),{stopped:true});
  for(const invalid of [{},{CLOUD_VENUE_SERVICE_LEVELS:'production'},{CLOUD_TEST_SERVICE_PLANS:'1'},
   {CLOUD_VENUE_SERVICE_LEVELS:'test',CLOUD_TEST_SERVICE_PLANS:'1'}]){
   await assert.rejects(run({...context,environment:invalid},{command:'relay-resume'}),/test_cloud.service_mode/);
   assert.deepEqual(await control.status(),{stopped:true});
  }
  await assert.rejects(run(context,{command:'translation',enabled:true}),/test_cloud.service_command/);
  assert.deepEqual(await run(context,{command:'relay-resume'}),{stopped:false});
  assert.deepEqual(await run(context,{command:'relay-status'}),{stopped:false});
 }finally{await db.close();}
});

test('owner relay command approves the completed signed origin statement and revokes its grant',async()=>{
 const run=await controls(),db=await database();
 try{
  const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const box=await connectedVenue(db,issuer,origin),context={pool:db.pool,issuer,origin,environment};
  const session=await transaction(db.pool,client=>createSession(client,box.accountId));
  const statement=box.proof('configuration',{servicesVersion:2,managementOrigin:'https://waitron.local:3000'},randomUUID(),box.lease);
  await new InstallationStore(db.pool,issuer,origin).execute('configuration',statement);
  const approval={installationId:box.installationId,expectedRevision:0,consent:true,consentVersion:'test-owner-v1',managementOrigin:'https://waitron.local:3000',expiresAt:new Date(Date.now()+1800000).toISOString()};
  const policy={version:'test-units-v1',units:3,periodSeconds:3600,epoch:'2026-01-01T00:00:00.000Z',excess:'refuse',debit:'retain'};
  const command={command:'relay-approve',session,approval,statement,policy};
  await assert.rejects(run(context,{...command,statement:undefined}),/test_cloud.service_command/);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM relay_grants')).rows[0].n,0);
  const grant=await run(context,command);
  assert.equal(grant.installationId,box.installationId);assert.equal(grant.enabled,true);assert.equal(grant.revision,1);
  assert.equal(grant.accountId,undefined,'stdout must omit the account and management-origin details');
  await assert.rejects(run(context,{...command,approval:{...approval,expectedRevision:1,consent:false}}),error=>error.code==='invalid_input');
  assert.deepEqual(await run(context,{command:'relay-revoke',session,grantId:grant.id}),{revoked:true});
  assert.equal((await db.pool.query('SELECT enabled FROM relay_grants WHERE id=$1',[grant.id])).rows[0].enabled,false);
 }finally{await db.close();}
});

// The child must use the selected database, finish schema checks and keep private stdin out of logs.
test('service command runs from private stdin and reports refusal without echoing secrets',async()=>{
 const db=await database(),directory=await mkdtemp(join(tmpdir(),'test-service-cli-'));
 try{
  await bootstrap(directory);
  const connection=new URL(process.env.TEST_DATABASE_URL);connection.searchParams.set('options','-c search_path='+db.schema);
  async function cli(input,overrides={}){
   const child=spawn(process.execPath,[new URL('./service-controls.mjs',import.meta.url).pathname],{env:{...process.env,...environment,LOCAL_STACK_CONFIG_DIR:directory,DATABASE_URL:connection.href,...overrides},stdio:['pipe','pipe','pipe']});
   let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);
   const completed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve({code,stdout,stderr}));});
   child.stdin.end(JSON.stringify(input));return completed;
  }
  const success=await cli({command:'relay-stop'});
  assert.equal(success.code,0,success.stderr);assert.deepEqual(JSON.parse(success.stdout),{stopped:true});
  const refused=await cli({command:'relay-resume',privateToken:'never-echo-this'}, {CLOUD_VENUE_SERVICE_LEVELS:'0'});
  assert.equal(refused.code,1);assert.equal(refused.stdout,'');assert.ok(!refused.stderr.includes('never-echo-this'));
  assert.deepEqual(await new RelayControl(db.pool).status(),{stopped:true});
 }finally{await rm(directory,{recursive:true,force:true});await db.close();}
});
