import {appendFile,chmod,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

const config=JSON.parse(process.argv[2]!);
const prepared=JSON.parse(await readFile(config.prepared,'utf8'));
if(!prepared.start||!prepared.manifest)throw new Error('child started before durable preparation');
if(config.ignoreTerm)process.on('SIGTERM',()=>{});
const server=createServer(socket=>socket.once('data',async bytes=>{
 if(bytes.toString()!=='show stat\n'){socket.destroy();return;}
 await appendFile(config.requests,'sample\n');
 const reply=JSON.parse(await readFile(config.control,'utf8'));
 while(reply.hold){try{await readFile(config.release);break;}catch{await delay(5);}}
 socket.end(reply.csv);
}));
await new Promise<void>(resolve=>server.listen(config.socket,resolve));
await chmod(config.socket,0o600);
await writeFile(config.ready,JSON.stringify({pid:process.pid,prepared:true}));
