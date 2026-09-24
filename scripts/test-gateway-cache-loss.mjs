import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,randomUUID,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {signManifest} from '../packages/remote-access/src/manifest.ts';
import {docker,waitFor} from './remote-fixtures.mjs';
const root=await mkdtemp(join(tmpdir(),'cloud-cache-loss-')),input=join(root,'input'),state=join(root,'state'),name='cloud-cache-loss-'+randomUUID(),cell=randomUUID();
const key=generateKeyPairSync('ed25519');let running=false;
try{
 await mkdir(input);await mkdir(state);await mkdir(join(input,'public-certs'));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=public.example.test','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem')],{stdio:'ignore'});
 await writeFile(join(input,'public-certs','site.pem'),Buffer.concat([await readFile(join(root,'key.pem')),await readFile(join(root,'cert.pem'))]),{mode:0o600});
 await writeFile(join(input,'issuer.pem'),key.publicKey.export({type:'spki',format:'pem'}));await writeFile(join(input,'bot.key'),randomBytes(32),{mode:0o600});await writeFile(join(input,'wireguard.key'),randomBytes(32).toString('base64'),{mode:0o600});
 const now=Date.now();await writeFile(join(input,'manifest.json'),JSON.stringify(signManifest({version:1,audience:'waitron-cloud-gateway',cellId:cell,sequence:5,issuedAt:now,expiresAt:now+600000,routes:[]},key.privateKey)));
 const start=()=>{docker('run','-d','--name',name,'--cap-add','NET_ADMIN','-v',input+':/input:ro','-v',state+':/state','-e','GATEWAY_CELL_ID='+cell,'waitron-cloud-local-remote:dev');running=true;};
 start();await waitFor(async()=>JSON.parse(await readFile(join(state,'status.json'),'utf8')).sequence===5);
 const priorPid=docker('exec',name,'pidof','haproxy');docker('exec',name,'pkill','-9','haproxy');
 await waitFor(()=>{const pid=docker('exec',name,'pidof','haproxy');return pid&&pid!==priorPid;},3000);assert.equal(JSON.parse(await readFile(join(state,'status.json'),'utf8')).ready,true);console.log('PASS: dead HAProxy child restarted from unexpired authority');
 docker('rm','-f',name);running=false;await rm(join(state,'accepted.json'));start();
 await waitFor(()=>docker('inspect','--format','{{.State.Running}}',name)==='false',3000);
 assert.notEqual(docker('inspect','--format','{{.State.ExitCode}}',name),'0');console.log('PASS: lost accepted cache after initial start refuses restart');
}finally{if(running)docker('rm','-f',name);await rm(root,{recursive:true,force:true});}
