import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {AddressLookupError,createGoogleAddressClient} from './address-lookup-google.ts';

// Only the private trial launcher injects this provider into its exact installation scope.
export function createTestBoxAddressLookup(options:{keyFile:string;fetcher:typeof fetch}){
 async function client(){
  try{
   const file=await open(options.keyFile,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   try{
    const stat=await file.stat();
    if(!stat.isFile()||(stat.mode&0o777)!==0o600||stat.uid!==process.getuid?.()||stat.size>8192)throw Error();
    const bytes=Buffer.alloc(8193),{bytesRead}=await file.read(bytes,0,bytes.length,0);
    if(bytesRead>8192)throw Error();
    const apiKey=parseEnv(bytes.subarray(0,bytesRead).toString('utf8')).GOOGLE_MAPS_SERVER_KEY;
    if(!apiKey)throw Error();
    return createGoogleAddressClient({apiKey,fetcher:options.fetcher});
   }finally{await file.close();}
  }catch{throw new AddressLookupError('unavailable',false);}
 }
 return {
  async suggest(...args:Parameters<ReturnType<typeof createGoogleAddressClient>['suggest']>){return (await client()).suggest(...args);},
  async validate(...args:Parameters<ReturnType<typeof createGoogleAddressClient>['validate']>){return (await client()).validate(...args);},
 };
}
