import {get} from 'node:http';
import {Readable} from 'node:stream';

// Node fetch replaces Host with the destination. Compose DNS is "account", while
// the account API requires its configured localhost authority even on health routes.
export function localHealthFetch(url,{signal}){
 return new Promise((resolve,reject)=>{
  const request=get(url,{headers:{host:'localhost:3000'},signal},response=>{
   try{resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers:response.headers}));}
   catch(error){response.destroy();reject(error);}
  });
  request.once('error',reject);
 });
}
