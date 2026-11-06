import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {transaction} from '../src/transaction.ts';
import {admitMailAttempt} from '../src/mail-attempts.ts';
import {lockMailScope} from '../src/recipient-suppression.ts';
import {fixture,config,keys} from './fixtures/mail-attempt.ts';
import {feedbackFixture,feedbackEvent,feedbackEnvelope} from './fixtures/ses-feedback.ts';

async function setup(){
 const f=await fixture(),dir=mkdtempSync(join(tmpdir(),'ses-command-'));
 try{
  const admission=await transaction(f.pool,async c=>admitMailAttempt(c,await f.account('owner@example.test')));
  const event=feedbackEvent();event.mail.tags['waitron-attempt']=[admission.attemptTag];
  const body=JSON.stringify(feedbackEnvelope(event)),settings=feedbackFixture();
  const file=join(dir,'config.json'),sample=join(dir,'sample.json');writeFileSync(file,JSON.stringify(settings.input));
  const connection=new URL(process.env.TEST_DATABASE_URL!);connection.searchParams.set('options',`-c search_path=${f.schema}`);
  function start(mode:string,once=false){
   const name=f.schema+'_command';
   const child=spawn(process.execPath,['--import',new URL('./fixtures/ses-feedback-cli-hooks.mjs',import.meta.url).href,
    new URL('../src/ses-feedback-cli.ts',import.meta.url).pathname,...(once?['--once']:[])],{
    env:{PATH:process.env.PATH,DATABASE_URL:connection.href,PGAPPNAME:name,CLOUD_SES_FEEDBACK_CONSUMER:'enabled',
     CLOUD_SES_FEEDBACK_CONFIG_FILE:file,CLOUD_MAIL_RECIPIENT_ACTIVE_KEY_ID:keys.activeKeyId,CLOUD_MAIL_RECIPIENT_KEYS:JSON.stringify(keys.keys),
     CLOUD_SES_FEEDBACK_HEALTH_SAMPLE_FILE:sample,LOCAL_FEEDBACK_POLICY:JSON.stringify(settings.policy),
     LOCAL_FEEDBACK_MODE:mode,LOCAL_FEEDBACK_BODY:body},stdio:['ignore','pipe','pipe','ipc']});
   let stdout='',stderr='';const messages:{stage:string;receives?:number}[]=[];
   child.stdout!.on('data',b=>{stdout+=b;});child.stderr!.on('data',b=>{stderr+=b;});child.on('message',m=>messages.push(m as typeof messages[number]));
   const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{
    child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
   const deadline=setTimeout(()=>child.kill('SIGKILL'),25000);
   const done=exited.finally(()=>clearTimeout(deadline));
   return {child,name,messages,done,output:()=>({stdout,stderr}),async dispose(){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await done;}};
  }
  return {...f,start,async counts(){return (await f.pool.query(`SELECT (SELECT count(*) FROM mail_feedback_receipts)::int AS receipts,
   (SELECT count(*) FROM mail_feedback_events)::int AS events,(SELECT count(*) FROM mail_suppressions)::int AS blocks`)).rows[0];},
   async close(){await f.close();rmSync(dir,{recursive:true,force:true});}};
 }catch(error){await f.close();rmSync(dir,{recursive:true,force:true});throw error;}
}
async function until(child:ReturnType<Awaited<ReturnType<typeof setup>>['start']>,check:()=>Promise<boolean>){
 const end=performance.now()+8000;
 while(performance.now()<end){if(await check())return;
  assert.equal(child.child.exitCode,null,child.output().stderr);assert.equal(child.child.signalCode,null);await delay(20);}
 assert.fail('the local command did not reach its expected boundary');
}
async function normal(child:ReturnType<Awaited<ReturnType<typeof setup>>['start']>){
 assert.deepEqual(await child.done,{code:0,signal:null});
 assert.equal(child.output().stderr,'');assert.match(child.output().stdout,/\{"drained":true,"code":0\}/);
 assert.doesNotMatch(child.output().stdout,/owner@example|private-handle|private invalid|local-secret/);
}

for(const signal of ['SIGINT','SIGTERM'] as const){
 test(`${signal} closes both real CLI polls and reaches natural process drain`,async()=>{
  const f=await setup(),child=f.start('idle');try{
   await until(child,async()=>child.messages.filter(m=>m.stage==='receive').length===2);
   child.child.kill(signal);await normal(child);assert.deepEqual(await f.counts(),{receipts:0,events:0,blocks:0});
   assert.equal((await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1',[child.name])).rowCount,0);
  }finally{await child.dispose();await f.close();}
 });
 test(`${signal} retains bounded database work and leaves its commit for restart acknowledgement`,async()=>{
  const f=await setup(),blocker=await f.pool.connect();let child:ReturnType<typeof f.start>|undefined;
  try{
   await blocker.query('BEGIN');await lockMailScope(blocker,config().scope);child=f.start('message');const active=child;
   await until(child,async()=>(await f.admin.query(`SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'`,[active.name])).rowCount!>0);
   child.child.kill(signal);await delay(100);assert.equal(child.child.exitCode,null);assert.equal(child.child.signalCode,null);
   await blocker.query('ROLLBACK');await normal(child);assert.equal(child.messages.some(m=>m.stage==='delete'),false);
   assert.deepEqual(await f.counts(),{receipts:1,events:1,blocks:1});
   const replay=f.start('replay',true);try{await normal(replay);assert.equal(replay.messages.filter(m=>m.stage==='delete').length,1);
    assert.deepEqual(await f.counts(),{receipts:1,events:1,blocks:1});}finally{await replay.dispose();}
  }finally{await blocker.query('ROLLBACK');blocker.release();await child?.dispose();await f.close();}
 });
}

test('process death after commit before deletion replays through the real CLI without another effect',async()=>{
 const f=await setup(),child=f.start('crash');try{
  await until(child,async()=>child.messages.some(m=>m.stage==='delete'));
  assert.deepEqual(await f.counts(),{receipts:1,events:1,blocks:1});child.child.kill('SIGKILL');
  assert.deepEqual(await child.done,{code:null,signal:'SIGKILL'});
  const replay=f.start('replay',true);try{await normal(replay);assert.deepEqual(await f.counts(),{receipts:1,events:1,blocks:1});
   assert.equal(replay.messages.filter(m=>m.stage==='delete').length,1);}finally{await replay.dispose();}
 }finally{await child.dispose();await f.close();}
});

test('a local provider stand-in redrives poison after five receives without deletion or automatic replay',async()=>{
 const f=await setup(),child=f.start('poison');try{
  await until(child,async()=>child.messages.some(m=>m.stage==='redriven'));
  assert.equal(child.messages.find(m=>m.stage==='redriven')!.receives,5);child.child.kill('SIGTERM');await normal(child);
  assert.equal(child.messages.some(m=>m.stage==='delete'),false);assert.deepEqual(await f.counts(),{receipts:0,events:0,blocks:0});
 }finally{await child.dispose();await f.close();}
});
