import {createServer} from 'node:http';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isHostname,isUuid} from '../../packages/remote-access/src/manifest.ts';

const tokenPattern=/^[A-Za-z0-9_-]{1,128}$/;
export function isTestRemoteHostname(hostname,zone){
 if(!isHostname(hostname)||!isHostname(zone))return false;
 const label=hostname.slice(0,-zone.length-1),id=label.startsWith('staff-v-')?label.slice(8):label.startsWith('v-')?label.slice(2):'';
 return hostname===label+'.'+zone&&isUuid(id);
}
function challengePath(directory,hostname,token){
 if(!isHostname(hostname)||!tokenPattern.test(token))throw Error('test_cloud.http_challenge');
 return join(directory,hostname,token);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const origin=new URL(process.env.TEST_CLOUD_ORIGIN),port=Number(process.env.TEST_CLOUD_HTTP_PORT??8080);
  if(origin.origin!==process.env.TEST_CLOUD_ORIGIN||origin.protocol!=='https:'||origin.port||!Number.isInteger(port)||port<0||port>65535)throw Error();
  const server=createHttpChallengeServer({accountHostname:origin.hostname,zone:process.env.TEST_CLOUD_REMOTE_ZONE,accountWebroot:process.env.TEST_CLOUD_ACCOUNT_WEBROOT,remoteDirectory:process.env.TEST_CLOUD_CHALLENGE_DIR});
  server.on('error',()=>{console.error('Test Cloud HTTP challenge listener failed');process.exitCode=1;});
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{server.close();server.closeAllConnections();});
  server.listen(port,'0.0.0.0',()=>console.log(JSON.stringify({status:'listening',port:server.address().port})));
 }catch{console.error('Test Cloud HTTP challenge settings are invalid');process.exitCode=1;}
}
export async function presentHttpChallenge(directory,hostname,token,value){
 const target=challengePath(directory,hostname,token),temporary=target+'.'+randomUUID();
 await mkdir(join(directory,hostname),{recursive:true,mode:0o700});
 try{await writeFile(temporary,value,{flag:'wx',mode:0o600});await rename(temporary,target);}finally{await rm(temporary,{force:true});}
}
export async function removeHttpChallenge(directory,hostname,token){await rm(challengePath(directory,hostname,token),{force:true});}
export function createHttpChallengeServer({accountHostname,zone,accountWebroot,remoteDirectory}){
 if(!isHostname(accountHostname)||!isHostname(zone)||!isAbsolute(accountWebroot)||!isAbsolute(remoteDirectory))throw Error('test_cloud.http_configuration');
 return createServer(async(req,res)=>{
  req.resume();
  const token=req.url?.match(/^\/\.well-known\/acme-challenge\/([A-Za-z0-9_-]{1,128})$/)?.[1],hostname=req.headers.host?.replace(/:80$/,'');
  const hosts=req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i].toLowerCase()==='host').length;
  if(req.method!=='GET'||!token||hosts!==1||!isHostname(hostname)){res.writeHead(404);res.end();return;}
  let path;
  if(hostname===accountHostname)path=join(accountWebroot,'.well-known/acme-challenge',token);
  else{
   if(isTestRemoteHostname(hostname,zone))path=challengePath(remoteDirectory,hostname,token);
  }
  try{if(!path)throw Error();const body=await readFile(path);res.writeHead(200,{'content-type':'text/plain','cache-control':'no-store','content-length':body.length});res.end(body);}
  catch{res.writeHead(404);res.end();}
 });
}
