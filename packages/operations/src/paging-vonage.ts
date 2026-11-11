import {configuration,callback,pagingMessage,pagingRequest,object,type Configuration,type Notification,type PagingProvider,type Kind,type ProviderEvent,type Submission} from './paging.ts';
const resource=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9-]{1,128}$/.test(value);
export function createVonage(c:Configuration&{apiKey:string;apiSecret:string;token:()=>Promise<string>}):PagingProvider{
 configuration(c);if(typeof c.apiKey!=='string'||!c.apiKey.length||typeof c.apiSecret!=='string'||!c.apiSecret.length||typeof c.token!=='function')throw new Error('paging.invalid_config');
 async function text(n:Notification):Promise<Submission>{
  const message=pagingMessage(n,c.origin),form=new URLSearchParams({to:c.to.slice(1),from:c.from.slice(1),text:message.text,type:'unicode','status-report-req':'true',callback:callback(c,n,'vonage','text')});
  const result=await pagingRequest(c,'https://rest.nexmo.com/sms/json',{Authorization:'Basic '+Buffer.from(c.apiKey+':'+c.apiSecret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},form.toString());
  if(result.state!=='ok')return result;
  const b=object(result.body);if(!Array.isArray(b.messages)||!b.messages.length||String(b['message-count'])!==String(b.messages.length))return {state:'unknown'};
  const parts=b.messages.map(object);if(parts.some(p=>typeof p.status!=='string'))return {state:'unknown'};
  if(parts.some(p=>p.status!=='0'))return {state:'failed'};
  const ids=parts.map(p=>p['message-id']);if(!ids.every(resource)||new Set(ids).size!==ids.length)return {state:'unknown'};
  return {state:'accepted',ids};
 }
 async function call(n:Notification):Promise<Submission>{
  const message=pagingMessage(n,c.origin);
  try{
   const token=await new Promise<string>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error()),c.timeoutMs);
    void Promise.resolve().then(()=>c.token()).then(resolve,reject).finally(()=>clearTimeout(timer));
   });
   if(typeof token!=='string'||!token.length||token.length>8192||!/^[A-Za-z0-9._~-]+$/.test(token))return {state:'unknown'};
   const result=await pagingRequest(c,'https://api.nexmo.com/v1/calls',{Authorization:'Bearer '+token,'Content-Type':'application/json'},JSON.stringify({
    to:[{type:'phone',number:c.to.slice(1)}],from:{type:'phone',number:c.from.slice(1)},event_url:[callback(c,n,'vonage','call')],event_method:'POST',ncco:[
     {action:'talk',text:message.voice,language:n.locale==='es'?'es-ES':'en-GB',bargeIn:true,bargeInType:['dtmf']},
     {action:'input',type:['dtmf'],dtmf:{maxDigits:1,timeOut:10},eventUrl:[callback(c,n,'vonage','input')],eventMethod:'POST'},
    ]}));
   if(result.state!=='ok')return result;
   const b=object(result.body);if(!resource(b.uuid))return {state:'unknown'};
   if(['failed','rejected','busy','timeout','unanswered','cancelled'].includes(String(b.status)))return {state:'failed'};
   return ['started','ringing','answered','completed'].includes(String(b.status))?{state:'accepted',ids:[b.uuid]}:{state:'unknown'};
  }catch{return {state:'unknown'};}
 }
 function readTrustedEvent(kind:Kind,raw:unknown):ProviderEvent|null{
  const b=object(raw),id=kind==='text'?b.messageId:b.uuid;
  if(!resource(id)||kind==='text'&&b['api-key']!==c.apiKey)return null;
  if(kind==='input'){const digits=object(b.dtmf).digits;return typeof digits==='string'?{provider:'vonage',kind,id,state:'input',digits}:null;}
  const states:Record<string,ProviderEvent['state']>=kind==='text'?{accepted:'pending',buffered:'pending',delivered:'delivered',expired:'failed',failed:'failed',rejected:'failed',unknown:'pending'}:{started:'pending',ringing:'pending',answered:'answered',completed:'completed',failed:'failed',rejected:'failed',busy:'failed',timeout:'failed',unanswered:'failed',cancelled:'failed'};
  return typeof b.status==='string'&&Object.hasOwn(states,b.status)?{provider:'vonage',kind,id,state:states[b.status]!}:null;
 }
 return {provider:'vonage',text,call,readTrustedEvent};
}
