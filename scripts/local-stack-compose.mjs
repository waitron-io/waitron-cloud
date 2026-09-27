import {get} from 'node:http';

export function requestAccountHealth(port,path){
 return new Promise((resolve,reject)=>{
  const request=get({host:'127.0.0.1',port,path,headers:{host:'localhost:3000'},timeout:3000},response=>{
   response.resume();
   response.once('end',()=>{
    if(response.statusCode!==undefined&&response.statusCode>=200&&response.statusCode<300)resolve();
    else reject(new Error(`account health failed: ${path} (${response.statusCode??'no status'})`));
   });
  });
  request.once('timeout',()=>request.destroy(new Error(`account health failed: ${path} (timeout)`)));
  request.once('error',reject);
 });
}
