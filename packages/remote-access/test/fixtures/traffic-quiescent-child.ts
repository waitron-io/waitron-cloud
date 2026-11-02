import {appendFile,chmod,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
const config=JSON.parse(process.argv[2]!);let paused=false;
const prepared=JSON.parse(await readFile(config.prepared,'utf8'));if(!prepared.start||!prepared.manifest)throw new Error('child started before preparation');
process.on('SIGTTOU',()=>{paused=true;});
const server=createServer(socket=>{let buffer='',interactive=false;socket.on('data',bytes=>{
 buffer+=bytes;for(;;){const i=buffer.indexOf('\n');if(i<0)break;const command=buffer.slice(0,i);buffer=buffer.slice(i+1);
  if(command==='prompt'){interactive=true;socket.write('\n> ');continue;}
  if(command!=='show stat'){socket.destroy();return;}
  void (async()=>{await appendFile(config.requests,'sample\n');const reply=JSON.parse(await readFile(config.control,'utf8'));
   if(reply.disconnect){socket.destroy();return;}
   const csv=paused?reply.csv:reply.csv.replaceAll('PAUSED','OPEN');if(interactive)socket.write(csv+'\n> ');else socket.end(csv);
  })().catch(()=>socket.destroy());
 }
});});
await new Promise<void>(r=>server.listen(config.socket,r));await chmod(config.socket,0o600);await writeFile(config.ready,JSON.stringify({pid:process.pid,prepared:true}));
