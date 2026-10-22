import {translationModel} from './service.ts';
export interface ModelCall {instructions:string;input:string;effort:'low'|'medium'}
export interface ModelReply {text:string;inputTokens:number;outputTokens:number}
export interface ModelClient {readonly provider:'openai';readonly model:string;respond(call:ModelCall,signal?:AbortSignal):Promise<ModelReply>}
type Usage={inputTokens:number;outputTokens:number};
export class ProviderError extends Error {
 readonly kind:'timeout'|'network'|'rate_limited'|'server'|'refused'|'redirect'|'malformed';
 readonly retryable:boolean;readonly retryAfterMs:number|undefined;readonly usage:Usage|undefined;
 constructor(kind:ProviderError['kind'],retryAfterMs?:number,usage?:Usage){
  super(kind);this.name='ProviderError';this.kind=kind;this.retryable=kind!=='refused'&&kind!=='redirect';this.retryAfterMs=retryAfterMs;this.usage=usage;
 }
}
const defaultBaseUrl='https://api.openai.com/v1';
export function openAiBaseUrl(env:NodeJS.ProcessEnv):string{
 const value=env.CLOUD_OPENAI_BASE_URL;
 if(value===undefined||value==='')return defaultBaseUrl;
 let url:URL;try{url=new URL(value);}catch{throw new Error('invalid_openai_base_url');}
 const loopback=url.protocol==='http:'&&(url.hostname==='127.0.0.1'||url.hostname==='localhost');
 if((url.protocol!=='https:'&&!loopback)||url.username||url.password||value.includes('?')||value.includes('#'))throw new Error('invalid_openai_base_url');
 return value.replace(/\/$/,'');
}
function retryAfter(value:string|null):number|undefined{
 if(value===null)return undefined;
 const text=value.trim(),date=Date.parse(text);
 // Date.parse accepts non-date strings that must not replace the retry backoff.
 const ms=/^\d+$/.test(text)?Number(text)*1000:new Date(date).toUTCString()===text?date-Date.now():NaN;
 return Number.isFinite(ms)?Math.min(60000,Math.max(0,ms)):undefined;
}
function stopped(error:unknown):ProviderError{
 if(error instanceof ProviderError)return error;
 return new ProviderError(error instanceof Error&&error.name==='TimeoutError'?'timeout':'network');
}
async function bounded(response:Response,max:number):Promise<string>{
 const reader=response.body?.getReader();if(!reader)return '';
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){
  const {done,value}=await reader.read();if(done)break;
  size+=value.byteLength;if(size>max){await reader.cancel();throw new ProviderError('malformed');}
  chunks.push(value);
 }
 return Buffer.concat(chunks).toString('utf8');
}
const record=(value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
function parseResponses(text:string):ModelReply{
 let data:Record<string,unknown>|undefined;try{data=record(JSON.parse(text));}catch{throw new ProviderError('malformed');}
 const usage=record(data?.usage),inputTokens=usage?.input_tokens,outputTokens=usage?.output_tokens;
 const counted=Number.isSafeInteger(inputTokens)&&Number.isSafeInteger(outputTokens)&&Number(inputTokens)>=0&&Number(outputTokens)>=0;
 const tokens=counted?{inputTokens:Number(inputTokens),outputTokens:Number(outputTokens)}:undefined;
 if(!data||!tokens)throw new ProviderError('malformed');
 // Valid usage must reach spending checks even when the billed reply is unusable.
 if(data.status!=='completed'||!Array.isArray(data.output))throw new ProviderError('malformed',undefined,tokens);
 const reply=data.output.flatMap(item=>{const message=record(item);return message?.type==='message'&&Array.isArray(message.content)?message.content:[];})
  .flatMap(part=>{const content=record(part);return content?.type==='output_text'&&typeof content.text==='string'?[content.text]:[];}).join('');
 return {text:reply,...tokens};
}
type ClientOptions={apiKey:string;baseUrl?:string;timeoutMs?:number;maxResponseBytes?:number};
export function createOpenAiClient(_options:ClientOptions):ModelClient{
 // No content is eligible for outbound AI until the separate privacy rule is accepted.
 return {provider:'openai',model:translationModel,async respond(){throw new ProviderError('refused');}};
}
export function createLoopbackOpenAiClient(options:ClientOptions&{baseUrl:string}):ModelClient{
 // Check the original authority so URL normalisation cannot permit alternate loopback spellings.
 const match=/^http:\/\/127\.0\.0\.1:([1-9][0-9]*)(?:\/[^?#\s\\]*)?$/.exec(options.baseUrl);
 if(!match||Number(match[1])>65535)throw new Error('invalid_openai_base_url');
 const url=new URL(options.baseUrl);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash)throw new Error('invalid_openai_base_url');
 return localTransport(options);
}
function localTransport(options:ClientOptions):ModelClient{
 const base=(options.baseUrl??defaultBaseUrl).replace(/\/$/,''),timeout=options.timeoutMs??120000,max=options.maxResponseBytes??4194304;
 return {provider:'openai',model:translationModel,async respond(call,signal){
  const combined=AbortSignal.any([AbortSignal.timeout(timeout),...(signal?[signal]:[])]);
  let response:Response;
  try{response=await fetch(base+'/responses',{method:'POST',redirect:'manual',signal:combined,
   headers:{authorization:`Bearer ${options.apiKey}`,'content-type':'application/json'},
   body:JSON.stringify({model:translationModel,instructions:call.instructions,input:call.input,reasoning:{effort:call.effort},store:false})});}
  catch(error){throw stopped(error);}
  if(response.status!==200){
   await response.body?.cancel();
   if(response.status>=300&&response.status<400)throw new ProviderError('redirect');
   if(response.status===429)throw new ProviderError('rate_limited',retryAfter(response.headers.get('retry-after')));
   if(response.status>=500)throw new ProviderError('server',retryAfter(response.headers.get('retry-after')));
   throw new ProviderError('refused');
  }
  let text:string;try{text=await bounded(response,max);}catch(error){throw stopped(error);}
  return parseResponses(text);
 }};
}
