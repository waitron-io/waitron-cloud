import {Resolver} from 'node:dns/promises';

export type ResolveCname=(hostname:string)=>Promise<string[]>;
export type ResolveTxt=(hostname:string)=>Promise<string[][]>;

async function boundedResolve<T>(name:string,query:(resolver:Resolver,name:string)=>Promise<T>,custom?:(name:string)=>Promise<T>):Promise<T>{
 const resolver=custom?undefined:new Resolver({timeout:1000,tries:1});let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([custom?custom(name):query(resolver!,name),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('dns_not_verified')),3000);})]);}
 finally{clearTimeout(timer);resolver?.cancel();}
}

export const boundedResolveCname=(name:string,custom?:ResolveCname)=>boundedResolve(name,(resolver,n)=>resolver.resolveCname(n),custom);
export const boundedResolveTxt=(name:string,custom?:ResolveTxt)=>boundedResolve(name,(resolver,n)=>resolver.resolveTxt(n),custom);
