import {once} from 'node:events';
import {createServer,type IncomingHttpHeaders} from 'node:http';
export interface FakeRequest {path:string;headers:IncomingHttpHeaders;body:{model:string;instructions:string;input:string;reasoning:{effort:string};store:boolean}}
export interface FakeReply {status?:number;headers?:Record<string,string>;json?:unknown;raw?:string;delayMs?:number}
type Usage={input_tokens:number;output_tokens:number};
export function responsesBody(text:string,usage:Usage={input_tokens:100,output_tokens:50}){
 return {id:'resp_test',status:'completed',model:'gpt-6-luna',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{...usage,output_tokens_details:{reasoning_tokens:0}}};
}
export const isReview=(r:FakeRequest)=>r.body.instructions.startsWith('You review');
export function echoFirstPass(r:FakeRequest,usage?:Usage):FakeReply{
 const shape=/\{"products": \[\{"id": "p01", (.*?), "placeholder"/.exec(r.body.instructions)?.[1]??'';
 const langs=[...shape.matchAll(/"([^"]+)": "\.\.\."/g)].map(m=>m[1]!);
 const rows=JSON.parse(r.body.input.slice(r.body.input.indexOf('Products:\n')+'Products:\n'.length)) as {id:string;internal:string}[];
 const products=rows.map(row=>({id:row.id,...Object.fromEntries(langs.map(l=>[l,`${row.internal} [${l}]`])),placeholder:false,corrections:[]}));
 return {json:responsesBody(JSON.stringify({products}),usage)};
}
export function emptyReview(usage?:Usage):FakeReply{return {json:responsesBody('{"changes": []}',usage)};}
export async function startFakeOpenAi(handler:(r:FakeRequest)=>FakeReply|Promise<FakeReply>){
 const requests:FakeRequest[]=[];
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk as Buffer);
  let body:FakeRequest['body'];
  try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{res.writeHead(400);res.end();return;}
  const r:FakeRequest={path:req.url??'',headers:req.headers,body};
  requests.push(r);
  let reply:FakeReply;try{reply=await handler(r);}catch{reply={status:500,json:{error:'fake handler failed'}};}
  if(reply.delayMs)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,reply.delayMs);res.once('close',()=>{clearTimeout(timer);resolve();});});
  if(res.destroyed)return;
  res.writeHead(reply.status??200,{'content-type':'application/json',...reply.headers});
  res.end(reply.raw??(reply.json===undefined?'':JSON.stringify(reply.json)));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();if(!address||typeof address==='string')throw new Error('fake server address');
 return {baseUrl:`http://127.0.0.1:${address.port}`,requests,async close(){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
