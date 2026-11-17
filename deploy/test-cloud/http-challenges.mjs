import {createServer} from 'node:http';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join,isAbsolute} from 'node:path';
import {isHostname,isUuid} from '../../packages/remote-access/src/manifest.ts';

const tokenPattern=/^[A-Za-z0-9_-]{1,128}$/;
function challengePath(directory,hostname,token){
 if(!isHostname(hostname)||!tokenPattern.test(token))throw Error('test_cloud.http_challenge');
 return join(directory,hostname,token);
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
  const token=req.url?.match(/^\/\.well-known\/acme-challenge\/([A-Za-z0-9_-]{1,128})$/)?.[1],hostname=req.headers.host;
  const hosts=req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i].toLowerCase()==='host').length;
  if(req.method!=='GET'||!token||hosts!==1||!isHostname(hostname)){res.writeHead(404);res.end();return;}
  let path;
  if(hostname===accountHostname)path=join(accountWebroot,'.well-known/acme-challenge',token);
  else{
   const label=hostname.slice(0,-zone.length-1),id=label.startsWith('staff-v-')?label.slice(8):label.startsWith('v-')?label.slice(2):'';
   if(hostname===label+'.'+zone&&isUuid(id))path=challengePath(remoteDirectory,hostname,token);
  }
  try{if(!path)throw Error();const body=await readFile(path);res.writeHead(200,{'content-type':'text/plain','cache-control':'no-store','content-length':body.length});res.end(body);}
  catch{res.writeHead(404);res.end();}
 });
}
