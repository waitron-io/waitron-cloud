import {validateHeaderValue} from 'node:http';

type SuggestInput={query:string;language:'es'|'en';sessionToken:string};
type ValidationInput={selectedText:string;sessionToken:string};
type ErrorCode='invalid_input'|'timeout'|'cancelled'|'rate_limited'|'refused'|'unavailable'|'malformed';
export class AddressLookupError extends Error{
 readonly code:ErrorCode;readonly dispatched:boolean;
 constructor(code:ErrorCode,dispatched:boolean){super(code);this.code=code;this.dispatched=dispatched;}
}
function fail(code:ErrorCode,dispatched=false):never{throw new AddressLookupError(code,dispatched);}
function record(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('malformed',true);
 return value as Record<string,unknown>;
}
function text(value:unknown):string{
 if(value===undefined)return '';
 if(typeof value!=='string')fail('malformed',true);
 return value;
}
function checkInput(value:unknown,token:unknown,validation=false){
 if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value,'utf8')>512
  ||(validation&&Array.from(value).length+2>280)
  ||typeof token!=='string'||!/^[-_A-Za-z0-9]{1,36}$/.test(token))fail('invalid_input');
}
function draft(value:unknown){
 const address=record(record(record(value).result).address),postal=record(address.postalAddress);
 if(postal.regionCode!=='ES')fail('malformed',true);
 const components=new Map<string,string>();
 if(address.addressComponents!==undefined){
  if(!Array.isArray(address.addressComponents))fail('malformed',true);
  for(const item of address.addressComponents){
   const component=record(item),kind=text(component.componentType),name=text(record(component.componentName).text);
   if(components.has(kind)&&components.get(kind)!==name)fail('malformed',true);
   components.set(kind,name);
  }
 }
 const country=components.get('country');
 if(country!==undefined&&!['es','españa','spain'].includes(country.normalize('NFC').toLowerCase()))fail('malformed',true);
 return {provider:'google' as const,fields:{
  addressLine1:[components.get('route'),components.get('street_number')].filter(Boolean).join(' '),
  addressLine2:components.get('subpremise')||null,postalCode:text(postal.postalCode),city:text(postal.locality),
  province:components.get('administrative_area_level_2')??'',countryCode:'ES' as const,
 }};
}

// This module has no startup or package-index wiring: admission must reserve before calling it.
export function createGoogleAddressClient(options:{apiKey:string;fetcher:typeof fetch}){
 if(!options||typeof options.apiKey!=='string'||!options.apiKey.trim()||typeof options.fetcher!=='function')fail('invalid_input');
 try{validateHeaderValue('X-Goog-Api-Key',options.apiKey);}catch{fail('invalid_input');}
 async function request(endpoint:string,body:unknown,caller?:AbortSignal):Promise<unknown>{
  if(caller?.aborted)fail('cancelled');
  const deadline=new AbortController(),signal=caller?AbortSignal.any([caller,deadline.signal]):deadline.signal;
  const timer=setTimeout(()=>deadline.abort(),5000);timer.unref();
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const cancel=()=>{void reader?.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try{
   const response=await options.fetcher(endpoint,{method:'POST',redirect:'error',signal,
    headers:{'Content-Type':'application/json','X-Goog-Api-Key':options.apiKey},body:JSON.stringify(body)});
   signal.throwIfAborted();
   if(!response.ok){
    void response.body?.cancel().catch(()=>{});
    fail(response.status===429?'rate_limited':response.status>=500?'unavailable':'refused',true);
   }
   reader=response.body?.getReader();if(!reader)fail('malformed',true);
   const chunks:Uint8Array[]=[];let size=0;
   for(;;){
    const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;
    size+=value.byteLength;if(size>65536)fail('malformed',true);chunks.push(value);
   }
   try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
   catch{fail('malformed',true);}
  }catch(error){
   // Once fetch starts, a failed or cancelled reply cannot prove the request was not billed.
   if(signal.aborted)fail(caller?.aborted?'cancelled':'timeout',true);
   if(error instanceof AddressLookupError)throw error;
   fail('unavailable',true);
  }finally{
   clearTimeout(timer);signal.removeEventListener('abort',cancel);cancel();deadline.abort();
  }
 }
 return {
  async suggest(input:SuggestInput,signal?:AbortSignal){
   checkInput(input?.query,input?.sessionToken);
   if(!['es','en'].includes(input.language))fail('invalid_input');
   const reply=record(await request('https://places.googleapis.com/v1/places:autocomplete',{
    input:input.query,includedRegionCodes:['es'],languageCode:input.language,sessionToken:input.sessionToken,
   },signal));
   if(reply.suggestions===undefined&&Object.keys(reply).length===0)return {provider:'google' as const,candidates:[]};
   if(!Array.isArray(reply.suggestions))fail('malformed',true);
   const candidates=reply.suggestions.slice(0,5).map(item=>{
    const name=record(record(record(item).placePrediction).text).text;
    if(typeof name!=='string'||!name.trim()||Buffer.byteLength(name,'utf8')>512)fail('malformed',true);
    return {text:name};
   });
   return {provider:'google' as const,candidates};
  },
  async validate(input:ValidationInput,signal?:AbortSignal){
   checkInput(input?.selectedText,input?.sessionToken,true);
   return draft(await request('https://addressvalidation.googleapis.com/v1:validateAddress',{
    address:{regionCode:'ES',addressLines:[input.selectedText]},sessionToken:input.sessionToken,
   },signal));
  },
 };
}
