import {readFile,open,rename,rm} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPrivateKey,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {RemoteAccessStore} from './placement.ts';
import {signManifest} from './manifest.ts';
import {issueCertificate,type DnsChallengeProvider} from './certificates.ts';
import {certificateNeedsRenewal} from './renewal.ts';
// This CLI is an operator boundary: its input files and DNS module must be trusted local files.
const [command,file]=process.argv.slice(2);
const commands=['cell','provision','move-stage','move-ready','move-commit','move-cancel','dns','hostname','export','certificate'];
if(!file||!commands.includes(command??''))throw new Error(`Usage: operator-cli.ts ${commands.join('|')} trusted-input.json`);
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
const config=JSON.parse(await readFile(file,'utf8'));
const pool=new Pool({connectionString:process.env.DATABASE_URL}),store=new RemoteAccessStore(pool);
async function atomic(path:string,value:string){
 const temporary=path+'.'+randomUUID();try{const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(value);await handle.sync();}finally{await handle.close();}await rename(temporary,path);const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}}finally{await rm(temporary,{force:true});}
}
let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stopping=true;});
try{
 if(command==='cell')await store.createCell(config);
 if(command==='provision')console.log(JSON.stringify(await store.provision(config.installationId,config.cellId,config.peerPublicKey,config.port??443)));
 if(command==='move-stage')console.log(JSON.stringify(await store.stageMove(config)));
 if(command==='move-ready')console.log(JSON.stringify(await store.markMoveReady(config.operationId,config.expectedRevision,config.sequence)));
 if(command==='move-commit')console.log(JSON.stringify(await store.completeMove(config.operationId,config.expectedRevision)));
 if(command==='move-cancel')console.log(JSON.stringify(await store.cancelMove(config.operationId,config.expectedRevision)));
 if(command==='dns')console.log(JSON.stringify(await store.hostnameInstructions(config.installationId,config.kind,config.hostname)));
 if(command==='hostname')console.log(JSON.stringify(await store.setHostname(config.installationId,config.kind,config.hostname,config.expectedRevision)));
 if(command==='export'){
  const key=createPrivateKey(await readFile(config.signingKeyFile));
  do{try{await atomic(config.output,JSON.stringify(signManifest(await store.manifest(config.cellId),key)));}catch{if(!config.watch)throw new Error('export_failed');console.error('remote.export_failed');}
   if(config.watch)for(let n=0;n<30&&!stopping;n++)await delay(1000);
  }while(config.watch&&!stopping);
 }
 if(command==='certificate'){
  const csr=await readFile(config.csrFile,'utf8');const names=await store.authorizeCertificate(config.installationId,config.kind,csr);
  let existing='';try{existing=await readFile(config.output,'utf8');}catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT'))throw error;}
  if(config.force===true||certificateNeedsRenewal(existing,csr,names.hostname)){
   const dns: DnsChallengeProvider=(await import(pathToFileURL(resolve(config.dnsModule)).href)).default;
   if(typeof dns?.present!=='function'||typeof dns?.remove!=='function')throw new Error('invalid_dns_provider');
   const certificate=await issueCertificate({directoryUrl:config.directoryUrl,accountKey:await readFile(config.accountKeyFile),email:config.email,csr,...names,dns});
   // Recheck active placement after external ACME work, before publishing a usable chain.
   const latest=await store.authorizeCertificate(config.installationId,config.kind,csr);if(JSON.stringify(latest)!==JSON.stringify(names))throw new Error('placement_changed');
   await atomic(config.output,certificate);
  }
 }
}catch{console.error('remote.command_failed');process.exitCode=1;}finally{await pool.end();}
