import {readFile,open,rename,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createPrivateKey,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {parsePlanMode} from '@waitron-cloud/registration';
import {RemoteAccessStore} from './placement.ts';
import {signManifest} from './manifest.ts';
// This CLI is an operator boundary: its input files and DNS module must be trusted local files.
const [command,file]=process.argv.slice(2);
const commands=['cell','provision','move-stage','move-ready','move-commit','move-cancel','dns','hostname','export'];
if(!file||!commands.includes(command??''))throw new Error(`Usage: operator-cli.ts ${commands.join('|')} trusted-input.json`);
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
const config=JSON.parse(await readFile(file,'utf8'));
const pool=new Pool({connectionString:process.env.DATABASE_URL});
async function atomic(path:string,value:string){
 const temporary=path+'.'+randomUUID();try{const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(value);await handle.sync();}finally{await handle.close();}await rename(temporary,path);const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}}finally{await rm(temporary,{force:true});}
}
let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stopping=true;});
try{
 const store=new RemoteAccessStore(pool,parsePlanMode(process.env.CLOUD_TEST_SERVICE_PLANS,process.env.CLOUD_VENUE_SERVICE_LEVELS));
 if(command==='cell'){if(typeof config.zone!=='string')throw new Error('invalid_cell');await store.createCell(config);}
 if(command==='provision')console.log(JSON.stringify(await store.provision(config.installationId,config.cellId,config.peerPublicKey,config.port??443)));
 if(command==='move-stage')console.log(JSON.stringify(await store.stageMove(config)));
 if(command==='move-ready')console.log(JSON.stringify(await store.markMoveReady(config.operationId,config.expectedRevision,config.sequence)));
 if(command==='move-commit')console.log(JSON.stringify(await store.completeMove(config.operationId,config.expectedRevision)));
 if(command==='move-cancel')console.log(JSON.stringify(await store.cancelMove(config.operationId,config.expectedRevision)));
 if(command==='dns')console.log(JSON.stringify(await store.hostnameInstructions(config.installationId,config.kind,config.hostname)));
 if(command==='hostname')console.log(JSON.stringify(await store.setHostname(config.installationId,config.kind,config.hostname,config.expectedRevision)));
 if(command==='export'){
  if(config.forwardReports!==undefined&&typeof config.forwardReports!=='boolean')throw new Error('invalid_export');
  const key=createPrivateKey(await readFile(config.signingKeyFile));
  do{try{await store[config.forwardReports===true?'publishReportingManifest':'publishManifest'](config.cellId,async manifest=>atomic(config.output,JSON.stringify(signManifest(manifest,key))));}catch{if(!config.watch)throw new Error('export_failed');console.error('remote.export_failed');}
   if(config.watch)for(let n=0;n<30&&!stopping;n++)await delay(1000);
  }while(config.watch&&!stopping);
 }
}catch{console.error('remote.command_failed');process.exitCode=1;}finally{await pool.end();}
