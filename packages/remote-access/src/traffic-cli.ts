import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {collectTraffic} from './traffic-collector.ts';
import {validateTrafficMapping,type TrafficMapping} from './traffic-coverage.ts';
import {TrafficStore} from './traffic-store.ts';

const stop=new AbortController(),shutdown=()=>stop.abort();let pool:Pool|undefined;
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
try{
 const [file,mode,...extra]=process.argv.slice(2);
 if(!file||!isAbsolute(file)||mode!==undefined&&mode!=='--once'||extra.length||!process.env.DATABASE_URL)throw new Error();
 const config:unknown=JSON.parse(await readFile(file,'utf8'));
 if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).join(',')!=='mappings'
  ||!('mappings'in config)||!Array.isArray(config.mappings)||!config.mappings.length)throw new Error();
 const mappings:TrafficMapping[]=[],cells=new Set<string>(),directories=new Set<string>();
 for(const mapping of config.mappings){
  validateTrafficMapping(mapping);
  if(cells.has(mapping.cellId)||directories.has(mapping.directory))throw new Error();
  cells.add(mapping.cellId);directories.add(mapping.directory);mappings.push(mapping);
 }
 pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,statement_timeout:5000});
 pool.on('error',()=>console.error('remote.traffic_collection_failed'));
 const store=new TrafficStore(pool);
 do{
  let succeeded=true;
  for(const mapping of mappings){
   try{await collectTraffic(mapping,store);}catch{console.error('remote.traffic_collection_failed');succeeded=false;}
  }
  if(mode==='--once'){if(!succeeded)process.exitCode=1;break;}
  // Finish the current durable acknowledgement before a signal interrupts the next poll wait.
  if(stop.signal.aborted)break;
  await delay(30000,undefined,{signal:stop.signal}).catch(()=>{});
 }while(!stop.signal.aborted);
}catch{console.error('remote.traffic_collector_failed');process.exitCode=1;}
finally{
 try{await pool?.end();}catch{process.exitCode=1;}
 process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
}
