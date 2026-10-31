import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {test} from 'node:test';

// Keep the CLI, scheduler, worker and retention queries real; replace only PostgreSQL I/O.
async function run(mode:'cadence'|'retry'){
 const preload=`
  import {registerHooks,syncBuiltinESMExports} from 'node:module';
  import timers from 'node:timers/promises';
  const state=globalThis.retentionCadence={now:0,sweeps:[],claims:[],waits:[],ended:false};
  Object.defineProperty(performance,'now',{configurable:true,value:()=>state.now});
  const advances=[60000,3539999,1];
  timers.setTimeout=async(ms,value,{signal}={})=>{
   if(signal?.aborted)throw signal.reason;
   state.waits.push(ms);
   if(state.waits.length>3)throw Error('unexpected extra wait');
   state.now+=${mode==='retry'?'ms':'advances.shift()'};
   return value;
  };
  syncBuiltinESMExports();
  const source=${JSON.stringify(`
   import {EventEmitter} from 'node:events';
   export class Pool extends EventEmitter{
    async connect(){const client=new EventEmitter();client.query=this.query.bind(this);client.release=()=>{};return client;}
    async query(sql,values){
     const s=globalThis.retentionCadence;
     if(sql.includes('FROM schema_migrations'))return {rows:[{count:values[0].length}]};
     if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
     if(sql.includes("state IN ('done'")){
      s.sweeps.push(s.now);
      if(${JSON.stringify(mode)}==='retry'&&s.sweeps.length===1)throw Error('controlled cleanup refusal');
      return {rows:[]};
     }
     if(sql.includes("WHERE state='queued'")){
      s.claims.push(s.now);
      if(${JSON.stringify(mode)}==='retry'||s.now>=3600000)process.emit('SIGTERM');
      return {rows:[]};
     }
     throw Error('unexpected SQL: '+sql);
    }
    async end(){const s=globalThis.retentionCadence;s.ended=true;console.log(JSON.stringify(s));}
   }
  `)};
  registerHooks({resolve(specifier,context,next){
   return specifier==='pg'?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(specifier,context);
  }});
 `;
 const child=spawn(process.execPath,['--import','data:text/javascript;base64,'+Buffer.from(preload).toString('base64'),new URL('../src/worker-cli.ts',import.meta.url).pathname],{
  env:{...process.env,DATABASE_URL:'postgres://localhost/controlled-retention',CLOUD_OPENAI_API_KEY:'controlled-retention-key',CLOUD_TRANSLATION_LOCAL_PROOF:'1',CLOUD_OPENAI_BASE_URL:'http://127.0.0.1:1/v1'},stdio:['ignore','pipe','pipe'],
 });
 let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 const deadline=setTimeout(()=>child.kill('SIGKILL'),5000);
 try{
  const [code,signal]=await once(child,'close');
  assert.deepEqual({code,signal,stderr},{code:0,signal:null,stderr:mode==='retry'?'Translation worker cleanup failed; retrying\n':''});
  return JSON.parse(stdout) as {sweeps:number[];claims:number[];waits:number[];ended:boolean};
 }finally{clearTimeout(deadline);}
}

test('the translation CLI sweeps at startup and the hourly boundary while polling between sweeps',async()=>{
 const state=await run('cadence');
 assert.deepEqual(state.sweeps,[0,3600000]);
 assert.deepEqual(state.claims,[0,0,60000,60000,3599999,3599999,3600000,3600000]);
 assert.deepEqual(state.waits,[1000,1000,1]);
 assert.equal(state.ended,true);
});

test('the translation CLI retries failed startup cleanup after a minute before claiming jobs',async()=>{
 const state=await run('retry');
 assert.deepEqual(state.sweeps,[0,60000]);
 assert.deepEqual(state.claims,[60000,60000]);
 assert.deepEqual(state.waits,[60000]);
 assert.equal(state.ended,true);
});
