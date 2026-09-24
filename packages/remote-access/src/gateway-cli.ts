import {createPublicKey} from 'node:crypto';
import {readFile,rename,mkdir,open} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {GatewayAuthority} from './authority.ts';
import {renderHaproxy,renderWireGuard} from './config.ts';
import {createPublicGate} from './public-gate.ts';
import {isUuid,isPeerKey,type GatewayRoute} from './manifest.ts';
const root=process.env.GATEWAY_STATE_DIR??'/state',input=process.env.GATEWAY_MANIFEST??'/input/manifest.json',cell=process.env.GATEWAY_CELL_ID??'';
if(!isUuid(cell))throw new Error('GATEWAY_CELL_ID required');
const trust=createPublicKey(await readFile(process.env.GATEWAY_TRUST_KEY??'/input/issuer.pem'));
const wgKey=(await readFile(process.env.GATEWAY_WIREGUARD_KEY??'/input/wireguard.key','utf8')).trim();if(!isPeerKey(wgKey))throw new Error('Invalid WireGuard key');
const subnet=Number(process.env.GATEWAY_SUBNET??0);if(!Number.isInteger(subnet)||subnet<0||subnet>255)throw new Error('Invalid subnet');
const run=(command:string,args:string[])=>execFileSync(command,args,{stdio:['ignore','pipe','pipe'],timeout:5000});
await mkdir(root,{recursive:true,mode:0o700});
async function atomic(name:string,value:string){const path=join(root,name),temporary=path+'.tmp';const file=await open(temporary,'w',0o600);try{await file.writeFile(value);await file.sync();}finally{await file.close();}await rename(temporary,path);const dir=await open(root,'r');try{await dir.sync();}finally{await dir.close();}}
// This process runs in an isolated Linux network namespace. It never edits host interfaces.
try{run('ip',['link','show','wg-cloud']);}catch{run('ip',['link','add','wg-cloud','type','wireguard']);}
run('ip',['address','replace',`10.77.${subnet}.1/24`,'dev','wg-cloud']);run('ip',['link','set','wg-cloud','up']);
run('iptables',['-P','FORWARD','DROP']);
await atomic('wireguard.conf',`[Interface]\nPrivateKey = ${wgKey}\nListenPort = 51820\n`);run('wg',['syncconf','wg-cloud',join(root,'wireguard.conf')]);
const children=new Set<ChildProcess>();let current:ChildProcess|undefined,lastRoutes='';
async function stop(){for(const child of children)child.kill('SIGTERM');current=undefined;lastRoutes='';await atomic('wireguard.conf',`[Interface]\nPrivateKey = ${wgKey}\nListenPort = 51820\n`);run('wg',['syncconf','wg-cloud',join(root,'wireguard.conf')]);}
async function apply(routes:GatewayRoute[]){
 const fingerprint=JSON.stringify(routes);if(fingerprint===lastRoutes&&current?.exitCode===null)return;
 await atomic('wireguard.conf',`[Interface]\nPrivateKey = ${wgKey}\nListenPort = 51820\n\n${renderWireGuard(routes)}`);
 run('wg',['syncconf','wg-cloud',join(root,'wireguard.conf')]);
 await atomic('haproxy.cfg',renderHaproxy(routes,{port:443,publicTlsPort:8444,gatePort:8080,certificateDirectory:'/input/public-certs'}));
 run('haproxy',['-c','-f',join(root,'haproxy.cfg')]);
 const args=['-db','-f',join(root,'haproxy.cfg'),...(current?.pid?['-sf',String(current.pid)]:[])];
 const child=spawn('haproxy',args,{stdio:['ignore','ignore','pipe']});children.add(child);child.stderr?.on('data',()=>{});child.once('exit',()=>children.delete(child));
 await new Promise<void>((resolve,reject)=>{child.once('error',reject);const timer=setTimeout(resolve,200);child.once('exit',()=>{clearTimeout(timer);reject(new Error('gateway_start_failed'));});});
 current=child;lastRoutes=fingerprint;
}
const authority=new GatewayAuthority(trust,cell,{persist:async envelope=>atomic('accepted.json',JSON.stringify(envelope)),apply,close:stop});
const gate=createPublicGate({key:await readFile(process.env.GATEWAY_BOT_KEY??'/input/bot.key'),ca:process.env.GATEWAY_UPSTREAM_CA?await readFile(process.env.GATEWAY_UPSTREAM_CA):undefined,routes:()=>authority.routes});
const server=createServer({maxHeaderSize:8192,requestTimeout:10000,headersTimeout:5000,connectionsCheckingInterval:1000},gate.handle);server.maxConnections=128;
await new Promise<void>(resolve=>server.listen(8080,'127.0.0.1',resolve));
try{await authority.restore(JSON.parse(await readFile(join(root,'accepted.json'),'utf8')));}catch(error){if(!(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT')){await stop();server.closeAllConnections();server.close();throw new Error('gateway.cache_unavailable');}}
let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stopping=true;});
let lastInput='';
try{while(!stopping){
 await authority.tick();
 try{const text=await readFile(input,'utf8');if(text!==lastInput){await authority.accept(JSON.parse(text));lastInput=text;}}
 catch(error){if(error instanceof Error&&error.message!=='invalid_manifest')console.error('gateway.refresh_unavailable');}
 await atomic('status.json',JSON.stringify({sequence:authority.sequence,routes:authority.routes.length,...gate.stats()}));
 await delay(1000);
}}finally{await stop();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
