import {createInterface} from 'node:readline';
const sent=new Map();let count=0;
for await(const line of createInterface({input:process.stdin})) {
 if(!line.includes('pw:protocol')){console.log(line);continue;}
 const match=line.match(/(SEND|RECV).*?(\{.*\})/);if(!match)continue;
 let message;try{message=JSON.parse(match[2]);}catch{continue;}
 const method=message.method;
 if(match[1]==='SEND'&&['Fetch.enable','Fetch.disable','Fetch.continueRequest','Fetch.failRequest'].includes(method)) {
  sent.set(message.id,method);
  if(count++<400)console.log(JSON.stringify({protocol:match[1],method,id:message.id,requestId:message.params?.requestId}));
 }else if(method==='Fetch.requestPaused') {
  const path=new URL(message.params.request.url).pathname;
  if(path.startsWith('/api/account/remote-access/')&&count++<400)console.log(JSON.stringify({protocol:match[1],method,path,requestId:message.params.requestId,networkId:message.params.networkId}));
 }else if(match[1]==='RECV'&&sent.has(message.id)&&count++<400) {
  console.log(JSON.stringify({protocol:match[1],method:sent.get(message.id),id:message.id,error:!!message.error}));sent.delete(message.id);
 }
}
