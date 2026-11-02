import assert from 'node:assert/strict';
import {appendFile,chmod,readFile,writeFile} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {createServer} from 'node:net';

const root=process.env.GATEWAY_FIXTURE_ROOT!,command=process.argv[2]!,args=process.argv.slice(3);
if(command==='wg'){
 assert.deepEqual(args.slice(0,2),['syncconf','wg-cloud']);
 await appendFile(join(root,'network'),JSON.stringify({at:Date.now(),wireguard:await readFile(args[2]!,'utf8')})+'\n');
}else if(command==='ip'||command==='iptables'){
 assert.ok(args.length>0);
}else if(command==='haproxy'){
 const config=await readFile(args[args.indexOf('-f')+1]!,'utf8');
 if(!args.includes('-c')){
  assert.ok(args.includes('-db'));
  const socket=/stats socket (\S+) mode 600 level operator/.exec(config)?.[1];
  if(socket){
   const processId=basename(socket,'.sock'),prepared=join(process.env.GATEWAY_TRAFFIC_STATE_DIRECTORY!,processId,'journal','prepared.json');
   let saved;try{saved=JSON.parse(await readFile(prepared,'utf8'));}catch{}
   await appendFile(join(root,'children'),JSON.stringify({pid:process.pid,processId,prepared:!!saved?.start,args,at:Date.now()})+'\n');
   assert.ok(saved?.start,'gateway must durably prepare before spawning HAProxy');
   assert.ok(await readFile(join(process.env.GATEWAY_TRAFFIC_STATE_DIRECTORY!,processId,'journal','spawn.claim'),'utf8'));
   const names=[...config.matchAll(/^backend (traffic_user_\w+)$/gm)].map(m=>m[1]);
   assert.equal(names.length,2);
   process.on('SIGTERM',()=>{});
   const server=createServer(s=>s.once('data',async bytes=>{
    assert.equal(bytes.toString(),'show stat\n');await appendFile(join(root,'samples'),processId+'\n');
    s.end('# pxname,svname,bin,bout,type\n'+names.map(n=>`${n},BACKEND,10,25,1\n`).join(''));
   }));
   await new Promise<void>(resolve=>server.listen(socket,resolve));await chmod(socket,0o600);
   await writeFile(join(root,processId+'.ready'),'1');
  }else{
   await appendFile(join(root,'children'),JSON.stringify({pid:process.pid,prepared:false,args,at:Date.now()})+'\n');
   setInterval(()=>{},1000);
  }
 }
}else throw Error('unexpected gateway system command');
