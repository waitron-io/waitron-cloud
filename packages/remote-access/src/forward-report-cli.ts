import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {parsePlanMode} from '@waitron-cloud/registration';
import {ForwardObservationStore} from './forward-observations.ts';
import {ForwardReportPoller,validateForwardMapping,type ForwardReportMapping} from './forward-report-collector.ts';

const stop=new AbortController(),shutdown=()=>stop.abort();let pool:Pool|undefined;
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
try{
 const [file,mode,...extra]=process.argv.slice(2);
 if(!file||!isAbsolute(file)||mode!==undefined&&mode!=='--once'||extra.length||!process.env.DATABASE_URL)throw new Error();
 const config:unknown=JSON.parse(await readFile(file,'utf8'));
 if(!config||typeof config!=='object'||Object.keys(config).join(',')!=='mappings'||!('mappings'in config)||!Array.isArray(config.mappings))throw new Error();
 const mappings:ForwardReportMapping[]=[];const cells=new Set<string>();
 for(const mapping of config.mappings){validateForwardMapping(mapping);if(cells.has(mapping.cellId))throw new Error();cells.add(mapping.cellId);mappings.push(mapping);}
 const planMode=parsePlanMode(process.env.CLOUD_TEST_SERVICE_PLANS,process.env.CLOUD_VENUE_SERVICE_LEVELS);
 pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,statement_timeout:5000});
 pool.on('error',()=>console.error('remote.forward_collection_failed'));
 const poller=new ForwardReportPoller(mappings,new ForwardObservationStore(pool,planMode),message=>console.error(message));
 do{const succeeded=await poller.poll();if(mode==='--once'){if(!succeeded)process.exitCode=1;break;}if(stop.signal.aborted)break;await delay(30000,undefined,{signal:stop.signal}).catch(()=>{});}while(!stop.signal.aborted);
}catch{console.error('remote.forward_collector_failed');process.exitCode=1;}
finally{try{await pool?.end();}catch{process.exitCode=1;}process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);}
