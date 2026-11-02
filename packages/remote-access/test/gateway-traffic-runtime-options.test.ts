import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {chmod,chown,cp,link,lstat,mkdir,mkdtemp,open,readFile,realpath,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {gatewayTrafficOptions} from '../src/gateway-traffic-options.ts';

const api=await import(new URL('../src/gateway-traffic-runtime-options.ts',import.meta.url).href).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return undefined;});
const unavailable=/^Error: traffic_runtime_unavailable$/;
const names=['STATE_DIRECTORY','REPORTER_KEY','REPORT_DIRECTORY','LIFETIME_SOCKET','READER_GID','MAX_BYTES'].map(n=>'GATEWAY_TRAFFIC_'+n);
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){
 const root=await realpath(await mkdtemp('/tmp/gtr-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const issuer=generateKeyPairSync('ed25519'),reporter=generateKeyPairSync('ed25519'),cellId=randomUUID();
 const keyFile=join(root,'reporter.pem'),state=join(root,'state'),reports=join(root,'reports'),sockets=join(root,'stats'),country=join(root,'country');
 for(const d of [state,reports,sockets,country])await mkdir(d,{mode:0o700});await chown(reports,process.geteuid!(),process.getegid!());await chmod(reports,0o2750);
 await writeFile(keyFile,reporter.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
 const wireguard=join(root,'wireguard.key'),bot=join(root,'bot.key');await writeFile(wireguard,'private-wireguard');await writeFile(bot,'private-bot');
 const env:NodeJS.ProcessEnv={GATEWAY_TRAFFIC_MODE:'test',GATEWAY_TRAFFIC_COUNTRY:'ES',GATEWAY_TRAFFIC_ENVIRONMENT:'test',GATEWAY_TRAFFIC_SOCKET_DIRECTORY:sockets,GATEWAY_TRAFFIC_OPERATIONAL_SOURCES:'["127.0.0.2"]',
  GATEWAY_TRAFFIC_STATE_DIRECTORY:state,GATEWAY_TRAFFIC_REPORTER_KEY:keyFile,GATEWAY_TRAFFIC_REPORT_DIRECTORY:reports,GATEWAY_TRAFFIC_LIFETIME_SOCKET:join(country,'lifetime.sock'),GATEWAY_TRAFFIC_READER_GID:String(process.getegid!()),GATEWAY_TRAFFIC_MAX_BYTES:'32768'};
 const load=(value=env,others=[wireguard,bot])=>{
  assert.equal(typeof api?.gatewayTrafficRuntimeOptions,'function','gateway must validate its private traffic runtime before networking');
  return api!.gatewayTrafficRuntimeOptions(value,gatewayTrafficOptions(value),issuer.publicKey,cellId,others);
 };
 return {root,issuer,reporter,cellId,keyFile,state,reports,sockets,country,env,load,wireguard,bot};
}

// Missing private configuration, accepting shared keys, or accepting public/symlinked paths must break these assertions.
test('private traffic configuration stays off without explicit traffic opt-in',async t=>{
 const f=await fixture(t);assert.equal(await f.load({}),undefined);assert.equal(await f.load({GATEWAY_FORWARD_REPORT_KEY:f.keyFile}),undefined);
});
test('private traffic configuration returns a scoped ES test mapping and dedicated signing key',async t=>{
 const f=await fixture(t),value=await f.load();assert.ok(value);
 assert.equal(value.directory,f.state);assert.equal(value.maxBytes,32768);assert.equal(value.lifetimeSocket,join(f.country,'lifetime.sock'));
 assert.deepEqual(value.mapping,{country:'ES',environment:'test',cellId:f.cellId,directory:f.reports,writerUid:process.geteuid!(),readerGid:process.getegid!()});
 assert.equal(value.reporterKey.type,'private');assert.equal(value.reporterKey.asymmetricKeyType,'ed25519');
 assert.equal(value.reporterKey.export({type:'pkcs8',format:'pem'}),f.reporter.privateKey.export({type:'pkcs8',format:'pem'}));
});
for(const name of names){
 test(`gateway refuses missing private option ${name}`,async t=>{const f=await fixture(t),env={...f.env};delete env[name];await assert.rejects(f.load(env),unavailable);});
 test(`gateway refuses orphan private option ${name}`,async t=>{const f=await fixture(t);await assert.rejects(f.load({[name]:f.env[name]}),unavailable);});
}
for(const [name,values] of [
 ['STATE_DIRECTORY',['relative','/state/../private','/']],['REPORTER_KEY',['relative','/key/../key']],['REPORT_DIRECTORY',['relative','/reports/../private']],['LIFETIME_SOCKET',['relative','/socket/../private']],
 ['READER_GID',['-1','1.5','01','9007199254740992']],['MAX_BYTES',['0','1023','67108865','1.5','032768','9007199254740992']],
] as const)for(const value of values)test(`gateway refuses malformed ${name} ${value}`,async t=>{
 const f=await fixture(t);await assert.rejects(f.load({...f.env,['GATEWAY_TRAFFIC_'+name]:value}),unavailable);
});
test('gateway refuses a reporter with the issuer key even in a different private file',async t=>{
 const f=await fixture(t);await writeFile(f.keyFile,f.issuer.privateKey.export({type:'pkcs8',format:'pem'}));await assert.rejects(f.load(),unavailable);
});
for(const other of ['wireguard','bot'] as const)test(`gateway refuses the ${other} key file as traffic authority`,async t=>{
 const f=await fixture(t);await writeFile(f[other],await readFile(f.keyFile),{mode:0o600});await chmod(f[other],0o600);
 await assert.rejects(f.load({...f.env,GATEWAY_TRAFFIC_REPORTER_KEY:f[other]}),unavailable);
});
for(const kind of ['symlink','hardlink','public','oversized','public-key','rsa','invalid','directory'] as const)test(`gateway refuses ${kind} reporter key storage`,async t=>{
 const f=await fixture(t);
 if(kind==='symlink'){const other=join(f.root,'real.pem');await writeFile(other,await readFile(f.keyFile),{mode:0o600});await rm(f.keyFile);await symlink(other,f.keyFile);}
 if(kind==='hardlink')await link(f.keyFile,join(f.root,'second.pem'));
 if(kind==='public')await chmod(f.keyFile,0o640);
 if(kind==='oversized')await writeFile(f.keyFile,(await readFile(f.keyFile,'utf8')).padEnd(4097,'\n'));
 if(kind==='public-key')await writeFile(f.keyFile,f.reporter.publicKey.export({type:'spki',format:'pem'}));
 if(kind==='rsa')await writeFile(f.keyFile,generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}));
 if(kind==='invalid')await writeFile(f.keyFile,'not a key');
 if(kind==='directory'){await rm(f.keyFile);await mkdir(f.keyFile,{mode:0o600});}
 await assert.rejects(f.load(),unavailable);
});
for(const [name,mode] of [['STATE_DIRECTORY',0o750],['REPORT_DIRECTORY',0o750],['SOCKET_DIRECTORY',0o750]] as const)test(`gateway refuses unsafe directory mode ${name}`,async t=>{
 const f=await fixture(t);await chmod(f.env['GATEWAY_TRAFFIC_'+name]!,mode);await assert.rejects(f.load(),unavailable);
});
test('gateway refuses a lifetime socket outside a private parent',async t=>{
 const f=await fixture(t);await chmod(f.country,0o755);await assert.rejects(f.load(),unavailable);
});
for(const name of ['STATE_DIRECTORY','REPORT_DIRECTORY','SOCKET_DIRECTORY'] as const)test(`gateway refuses a symlinked ${name}`,async t=>{
 const f=await fixture(t),path=f.env['GATEWAY_TRAFFIC_'+name]!,alias=path+'-alias';await symlink(path,alias);
 await assert.rejects(f.load({...f.env,['GATEWAY_TRAFFIC_'+name]:alias}),unavailable);
});
for(const [name,target] of [['REPORT_DIRECTORY','state'],['STATE_DIRECTORY','sockets'],['LIFETIME_SOCKET','keyFile'],['REPORTER_KEY','state']] as const)test(`gateway refuses overlapping ${name} and ${target}`,async t=>{
 const f=await fixture(t);await assert.rejects(f.load({...f.env,['GATEWAY_TRAFFIC_'+name]:f[target]}),unavailable);
});
test('gateway refuses a different report reader group before accepting private options',async t=>{
 const f=await fixture(t);await assert.rejects(f.load({...f.env,GATEWAY_TRAFFIC_READER_GID:String(process.getegid!()+1)}),unavailable);
});
test('gateway CLI refuses incomplete runtime before opening base keys or networking',async t=>{
 const f=await fixture(t),env={...f.env};for(const n of names)delete env[n];
 const result=spawnSync(process.execPath,[new URL('../src/gateway-cli.ts',import.meta.url).pathname],{encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,...env,GATEWAY_CELL_ID:f.cellId,GATEWAY_STATE_DIR:join(f.root,'base')}});
 assert.equal(result.status,1);assert.match(result.stderr,/traffic_runtime_unavailable/);assert.doesNotMatch(result.stderr,/ENOENT|wireguard|iptables/);
});
test('gateway refuses nested private roots even when each directory is individually private',async t=>{
 const f=await fixture(t),nested=join(f.state,'nested');await mkdir(nested,{mode:0o700});
 await assert.rejects(f.load({...f.env,GATEWAY_TRAFFIC_STATE_DIRECTORY:nested,GATEWAY_TRAFFIC_SOCKET_DIRECTORY:f.state}),unavailable);
});
test('gateway refuses its reporter key within durable traffic state',async t=>{
 const f=await fixture(t),nested=join(f.state,'reporter.pem');await rename(f.keyFile,nested);
 await assert.rejects(f.load({...f.env,GATEWAY_TRAFFIC_REPORTER_KEY:nested}),unavailable);
});
test('gateway refuses a symlinked lifetime parent',async t=>{
 const f=await fixture(t),alias=join(f.root,'alias');await symlink(f.country,alias);
 await assert.rejects(f.load({...f.env,GATEWAY_TRAFFIC_LIFETIME_SOCKET:join(alias,'lifetime.sock')}),unavailable);
});
test('gateway refuses a symlink in the state directory ancestry',async t=>{
 const f=await fixture(t),alias=join(f.root,'alias');await symlink(f.root,alias);
 await assert.rejects(f.load({...f.env,GATEWAY_TRAFFIC_STATE_DIRECTORY:join(alias,'state')}),unavailable);
});
test('gateway refuses a symlink in the reporter key ancestry',async t=>{
 const f=await fixture(t),alias=join(f.root,'alias');await symlink(f.root,alias);
 await assert.rejects(f.load({...f.env,GATEWAY_TRAFFIC_REPORTER_KEY:join(alias,'reporter.pem')}),unavailable);
});
test('gateway refuses a replaced key path during the bounded read',async t=>{
 const f=await fixture(t),handle=await open(f.keyFile,'r'),prototype=Object.getPrototypeOf(handle),original=prototype.read;
 await handle.close();let replaced=false;
 const hook=t.mock.method(prototype,'read',async function(this:any,...args:any[]){
  const reply=await original.apply(this,args);
  if(!replaced){replaced=true;const replacement=join(f.root,'replacement.pem');await writeFile(replacement,await readFile(f.keyFile),{mode:0o600});await rename(replacement,f.keyFile);}
  return reply;
 });
 try{await assert.rejects(f.load(),unavailable);assert.equal(replaced,true);}finally{hook.mock.restore();}
});
test('gateway CLI validates private files before any networking command',async t=>{
 const f=await fixture(t),trust=join(f.root,'issuer.pem');await writeFile(trust,f.issuer.publicKey.export({type:'spki',format:'pem'}));
 await chmod(f.keyFile,0o640);
 const result=spawnSync(process.execPath,[new URL('../src/gateway-cli.ts',import.meta.url).pathname],{encoding:'utf8',timeout:10000,
  env:{PATH:process.env.PATH,...f.env,GATEWAY_CELL_ID:f.cellId,GATEWAY_TRUST_KEY:trust,GATEWAY_WIREGUARD_KEY:f.wireguard,GATEWAY_BOT_KEY:f.bot}});
 assert.equal(result.status,1);assert.match(result.stderr,/traffic_runtime_unavailable/);assert.doesNotMatch(result.stderr,/ENOENT|Invalid WireGuard|spawnSync/);
});
test('gateway source-only image validates traffic without workspace packages or node_modules',async t=>{
 const f=await fixture(t),source=join(f.root,'src');await cp(new URL('../src',import.meta.url),source,{recursive:true});
 const env={...f.env};for(const name of names)delete env[name];
 const result=spawnSync(process.execPath,[join(source,'gateway-cli.ts')],{encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,...env,GATEWAY_CELL_ID:f.cellId}});
 assert.equal(result.status,1);assert.match(result.stderr,/traffic_runtime_unavailable/);assert.doesNotMatch(result.stderr,/ERR_MODULE_NOT_FOUND|ENOENT|wireguard|iptables/);
});
test('gateway refuses report exchange on a different filesystem',{skip:process.platform!=='linux'?'requires the Linux shared-memory filesystem':false},async t=>{
 const f=await fixture(t),reports=await realpath(await mkdtemp('/dev/shm/gtr-'));t.after(()=>rm(reports,{recursive:true,force:true}));
 await chown(reports,process.geteuid!(),process.getegid!());await chmod(reports,0o2750);
 assert.notEqual((await lstat(reports)).dev,(await lstat(f.state)).dev,'fixture must provide two real filesystems');
 await assert.rejects(f.load({...f.env,GATEWAY_TRAFFIC_REPORT_DIRECTORY:reports}),unavailable);
});
