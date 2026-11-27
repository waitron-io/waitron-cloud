import assert from 'node:assert/strict';
import {createPrivateKey,createPublicKey} from 'node:crypto';

export function fakeVenueMailProviders(suffix:string,testDomains:readonly string[]){
 const identities=new Map<string,{tag:string;selectors:string[];external:boolean;verified:boolean;lost?:true}>();
 const txt=new Map<string,string>();
 const writes:string[]=[];
 let loseSes=false,loseDns=false,publicKey:string|undefined,alias=true;
 const options={
  config:{suffix,zoneId:'Z123',region:'eu-north-1',testDomains},
  ses:{
   async read(name:string){return identities.get(name)??null;},
   async create(name:string,selector:string,tag:string,key:string):Promise<'accepted'|'refused'>{
    assert.equal(identities.has(name),false);
    const privateKey=createPrivateKey({key:Buffer.from(key,'base64'),type:'pkcs8',format:'der'});
    assert.equal(privateKey.asymmetricKeyDetails?.modulusLength,2048);
    publicKey=createPublicKey(privateKey).export({type:'spki',format:'der'}).toString('base64');
    identities.set(name,{tag,selectors:[selector],external:true,verified:true});writes.push('ses create');
    if(loseSes)throw Error('SES reply lost');
    return 'accepted' as const;
   },
   async remove(name:string){identities.delete(name);writes.push('ses delete');},
  },
  dns:{
   async checkZone(){},
   async read(name:string,key:string){
    const value=txt.get(name);
    return value===undefined?'absent' as const:value===key?'matching' as const:'different' as const;
   },
   async create(name:string,key:string){assert.equal(key,publicKey);txt.set(name,key);writes.push('dns create');if(loseDns)throw Error('DNS reply lost');},
   async remove(name:string,key:string){assert.equal(txt.get(name),key);txt.delete(name);writes.push('dns delete');},
  },
  resolveCname:async(name:string)=>alias?[name.split('.')[0]+'.mail.'+suffix]:['other.example.test'],
  resolveTxt:async(name:string)=>txt.has(name)?[['v=DKIM1; k=rsa; p=',txt.get(name)!]]:[],
 };
 return {options,identities,txt,writes,
  loseReplies(ses:boolean,dns:boolean){loseSes=ses;loseDns=dns;},
  alias(value:boolean){alias=value;},
 };
}
