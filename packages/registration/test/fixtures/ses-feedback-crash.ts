import {Pool} from 'pg';
import {applySesFeedback} from '../../src/ses-feedback-store.ts';
import {config,keys} from './mail-attempt.ts';

const {schema,stage,event}=JSON.parse(process.argv[2]!);
if(!/^mail_attempt_[a-f0-9]+$/.test(schema)||!['before','after'].includes(stage))throw Error('invalid crash fixture');
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
// Intercept only COMMIT around the real query; the parent kills this process at that boundary.
pool.on('connect',client=>{
 const query=client.query.bind(client);
 Object.defineProperty(client,'query',{value:async(...args:unknown[])=>{
  if(args[0]==='COMMIT'&&stage==='before'){
   process.send!(stage);await new Promise(()=>{});
  }
  const result=await Reflect.apply(query,client,args);
  if(args[0]==='COMMIT'&&stage==='after'){
   process.send!(stage);await new Promise(()=>{});
  }
  return result;
 }});
});
await applySesFeedback(pool,config(),keys,event);
await pool.end();
