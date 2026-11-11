import {configuration,callback,pagingMessage,pagingRequest,object,type Configuration,type Notification,type PagingProvider,type Kind,type ProviderEvent,type Submission} from './paging.ts';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export function createTwilio(c:Configuration&{accountSid:string;token:string}):PagingProvider{
 configuration(c);if(!/^AC[0-9a-f]{32}$/.test(c.accountSid)||typeof c.token!=='string'||!c.token.length)throw new Error('paging.invalid_config');
 const headers={Authorization:'Basic '+Buffer.from(c.accountSid+':'+c.token).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'};
 async function submit(n:Notification,kind:'text'|'call'):Promise<Submission>{
  const message=pagingMessage(n,c.origin),form=new URLSearchParams({To:c.to,From:c.from,StatusCallback:callback(c,n,'twilio',kind)});
  if(kind==='text')form.set('Body',message.text);
  else{
   const es=n.locale==='es';form.set('Twiml',`<Response><Gather input="dtmf" numDigits="1" timeout="10" action="${escape(callback(c,n,'twilio','input'))}" method="POST"><Say voice="${es?'Google.es-ES-Standard-A':'Google.en-GB-Standard-N'}" language="${es?'es-ES':'en-GB'}">${escape(message.voice)}</Say></Gather></Response>`);
   form.set('StatusCallbackMethod','POST');for(const event of ['answered','completed'])form.append('StatusCallbackEvent',event);
  }
  const result=await pagingRequest(c,`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/${kind==='text'?'Messages':'Calls'}.json`,headers,form.toString());
  if(result.state!=='ok')return result;
  const body=object(result.body),prefix=kind==='text'?'SM':'CA';
  if(typeof body.sid!=='string'||!new RegExp('^'+prefix+'[0-9a-f]{32}$').test(body.sid))return {state:'unknown'};
  if(['failed','undelivered','busy','no-answer','canceled'].includes(String(body.status)))return {state:'failed'};
  if(!['accepted','queued','sending','sent','delivered','ringing','in-progress','completed'].includes(String(body.status)))return {state:'unknown'};
  return {state:'accepted',ids:[body.sid]};
 }
 function readTrustedEvent(kind:Kind,raw:unknown):ProviderEvent|null{
  const b=object(raw);if(b.AccountSid!==c.accountSid)return null;
  const id=kind==='text'?b.MessageSid:b.CallSid;if(typeof id!=='string'||!new RegExp('^'+(kind==='text'?'SM':'CA')+'[0-9a-f]{32}$').test(id))return null;
  if(kind==='input')return typeof b.Digits==='string'?{provider:'twilio',kind,id,state:'input',digits:b.Digits}:null;
  const status=kind==='text'?b.MessageStatus:b.CallStatus;
  const states:Record<string,ProviderEvent['state']>=kind==='text'?{queued:'pending',accepted:'pending',sending:'pending',sent:'pending',delivered:'delivered',failed:'failed',undelivered:'failed'}:{queued:'pending',ringing:'pending','in-progress':'answered',completed:'completed',busy:'failed',failed:'failed','no-answer':'failed',canceled:'failed'};
  return typeof status==='string'&&Object.hasOwn(states,status)?{provider:'twilio',kind,id,state:states[status]!}:null;
 }
 return {provider:'twilio',text:n=>submit(n,'text'),call:n=>submit(n,'call'),readTrustedEvent};
}
