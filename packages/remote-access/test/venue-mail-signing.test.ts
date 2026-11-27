import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {set,venueServiceFixture} from '../../registration/test/fixtures/venue-service.ts';
import {fakeVenueMailProviders} from './fixtures/venue-mail-signing.ts';
import {runVenueMailSigning} from '../src/venue-mail-signing.ts';

const domain='cafe.example.test',suffix='cloud.example.test';

async function fixture(){
 const db=await venueServiceFixture();
 const signing=fakeVenueMailProviders(suffix,[domain]);
 return {db,...signing,
  async choose(venueId=db.venues[0]!){
   const selector=randomUUID();
   await set(db,'connected',venueId);
   await db.pool.query('UPDATE venues SET waitron_mail_from=$2,waitron_mail_dns_token=$3 WHERE id=$1',
    [venueId,'office@'+domain,selector]);
   return selector;
  },
  run(venueId:string=db.venues[0]!){return runVenueMailSigning(db.pool,venueId,signing.options);},
 };
}

test('resume after unconfirmed provider writes and retire after the sender is cleared',async t=>{
 const f=await fixture();t.after(f.db.close);
 const venueId=f.db.venues[0],selector=await f.choose(),target=selector+'.mail.'+suffix;
 f.alias(false);
 assert.equal(await f.run(),'awaiting_dns');
 assert.deepEqual(f.writes,[]);
 f.alias(true);f.loseReplies(true,false);
 await assert.rejects(f.run(),/SES reply lost/);
 assert.deepEqual(f.writes,['ses create']);
 f.loseReplies(false,true);
 await assert.rejects(f.run(),/DNS reply lost/);
 f.loseReplies(false,false);
 assert.equal(await f.run(),'verified');
 assert.deepEqual(f.writes,['ses create','dns create']);
 assert.ok(f.txt.has(target));

 const identity=f.identities.get(domain)!;
 f.identities.set(domain,{...identity,tag:randomUUID()});
 await f.db.pool.query('UPDATE venues SET waitron_mail_from=NULL,waitron_mail_dns_token=NULL WHERE id=$1',[venueId]);
 assert.equal(await f.run(),'held');
 assert.deepEqual(f.writes,['ses create','dns create']);
 f.identities.set(domain,identity);
 const savedValue=f.txt.get(target)!;
 f.txt.set(target,'different value');
 assert.equal(await f.run(),'held');
 assert.equal(f.txt.get(target),'different value');
 assert.deepEqual(f.writes,['ses create','dns create','ses delete']);
 f.txt.set(target,savedValue);
 assert.equal(await f.run(),'retired');
 assert.deepEqual(f.writes,['ses create','dns create','ses delete','dns delete']);
 assert.equal(f.identities.size,0);assert.equal(f.txt.size,0);
 assert.equal((await f.db.pool.query('SELECT 1 FROM venue_mail_signing')).rowCount,0);
});

test('two venues cannot both claim a domain and inherited verification does not verify the winner',async t=>{
 const f=await fixture();t.after(f.db.close);
 const [first,second]=f.db.venues;assert.ok(first&&second);
 await f.choose(first);await f.choose(second);
 const results=await Promise.all([f.run(first),f.run(second)]);
 assert.deepEqual(results.toSorted(),['held','verified']);
 assert.deepEqual(f.writes,['ses create','dns create']);
 const identity=f.identities.get(domain)!;
 f.identities.set(domain,{...identity,selectors:['parent-domain-selector']});
 assert.equal(await f.run(results[0]==='verified'?first:second),'held');
 assert.deepEqual(f.writes,['ses create','dns create']);
});

test('a retry cannot replace newer claim data it did not read',async t=>{
 const f=await fixture();t.after(f.db.close);
 const venueId=f.db.venues[0]!;
 await f.choose();
 const create=f.options.ses.create;
 f.options.ses.create=async()=>{throw Error('write rejected');};
 await assert.rejects(f.run(),/write rejected/);
 f.options.ses.create=create;
 const newTag=randomUUID(),read=f.options.dns.read;
 f.options.dns.read=async(name,key)=>{
  await f.db.pool.query('UPDATE venue_mail_signing SET tag=$2 WHERE venue_id=$1',[venueId,newTag]);
  return read(name,key);
 };
 assert.equal(await f.run(),'held');
 assert.deepEqual(f.writes,[]);
 assert.deepEqual((await f.db.pool.query('SELECT tag FROM venue_mail_signing WHERE venue_id=$1',[venueId])).rows,[{tag:newTag}]);
});

test('the signing command requires test mode and can inspect a production venue without contacting providers',async t=>{
 const db=await venueServiceFixture();t.after(db.close);
 const url=new URL(process.env.TEST_DATABASE_URL!);
 const {name}=(await db.pool.query('SELECT current_database() AS name')).rows[0];
 url.pathname='/'+name;
 url.searchParams.set('options','-c search_path='+db.schema);
 const env={
  DATABASE_URL:url.toString(),
  AWS_ENDPOINT_URL:'http://127.0.0.1:1',
  AWS_ACCESS_KEY_ID:'test',
  AWS_SECRET_ACCESS_KEY:'test',
  CLOUD_VENUE_MAIL_DNS_SUFFIX:suffix,
  CLOUD_VENUE_MAIL_DNS_ZONE_ID:'Z123',
  CLOUD_VENUE_MAIL_SES_REGION:'eu-north-1',
  CLOUD_VENUE_MAIL_TEST_DOMAINS:domain,
 };
 const run=(extra:NodeJS.ProcessEnv)=>spawnSync(process.execPath,['src/venue-mail-signing-cli.ts',db.production],{
  env:{...env,...extra},encoding:'utf8',timeout:5000,
 });
 const refused=run({});
 assert.equal(refused.status,1);assert.match(refused.stderr,/test venue levels/);
 const ineligible=run({CLOUD_VENUE_SERVICE_LEVELS:'test'});
 assert.equal(ineligible.status,0,ineligible.stderr);assert.equal(ineligible.stdout.trim(),'ineligible');
});
