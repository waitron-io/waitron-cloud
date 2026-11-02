import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {Pool} from 'pg';
import {TrafficCoverageStore,type TrafficMapping} from './traffic-coverage.ts';
import {serveTrafficLifetimes} from './traffic-lifetime-transport.ts';

const stop=new AbortController(),shutdown=()=>stop.abort();let pool:Pool|undefined,server:Awaited<ReturnType<typeof serveTrafficLifetimes>>|undefined;
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
try{
 const [file,...extra]=process.argv.slice(2);
 if(!file||!isAbsolute(file)||extra.length||!process.env.DATABASE_URL)throw new Error();
 const config:unknown=JSON.parse(await readFile(file,'utf8'));
 if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).sort().join(',')!=='mappings,socket'
  ||!('socket'in config)||typeof config.socket!=='string'||!('mappings'in config)||!Array.isArray(config.mappings))throw new Error();
 pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,statement_timeout:5000});
 pool.on('error',()=>console.error('remote.traffic_lifetime_server_failed'));
 server=await serveTrafficLifetimes({socket:config.socket,mappings:config.mappings as TrafficMapping[],store:new TrafficCoverageStore(pool)});
 if(!stop.signal.aborted)await new Promise<void>(resolve=>stop.signal.addEventListener('abort',()=>resolve(),{once:true}));
}catch{console.error('remote.traffic_lifetime_server_failed');process.exitCode=1;}
finally{
 // Drain country commits before ending their pool, even if their exporters disconnected.
 try{await server?.close();}catch{process.exitCode=1;}
 try{await pool?.end();}catch{process.exitCode=1;}
 process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
}
