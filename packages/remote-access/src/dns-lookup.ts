import {Resolver} from 'node:dns/promises';

export type ResolveCname=(hostname:string)=>Promise<string[]>;
export async function boundedResolveCname(name:string,custom?:ResolveCname):Promise<string[]>{
 const resolver=custom?undefined:new Resolver({timeout:1000,tries:1});let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([(custom??(n=>resolver!.resolveCname(n)))(name),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('dns_not_verified')),3000);})]);}
 finally{clearTimeout(timer);resolver?.cancel();}
}
