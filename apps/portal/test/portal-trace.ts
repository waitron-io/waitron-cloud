import type {Page,Request} from 'playwright';

// Record only static endpoint names and timing, never reset tokens, cookies or bodies.
export function portalTrace(page:Page) {
 const started=performance.now(),events:object[]=[],requests=new WeakMap<Request,number>();
 const paths=new Set(['/api/account/session','/api/account/session/activity','/api/account/login','/api/account/password-reset/request','/api/account/password-reset/complete','/api/account/translation-consent','/api/account/signup/complete']);
 const record=(event:object)=>{events.push({ms:Math.round(performance.now()-started),...event});if(events.length>100)events.shift();};
 const details=(request:Request)=>{const path=new URL(request.url()).pathname;return paths.has(path)?{method:request.method(),path}:undefined;};
 page.on('request',request=>{const data=details(request);if(data){requests.set(request,performance.now());record({event:'request',...data});}});
 page.on('response',response=>{const request=response.request(),data=details(request);if(data)record({event:'response',...data,status:response.status(),elapsed:Math.round(performance.now()-(requests.get(request)??performance.now()))});});
 page.on('requestfinished',request=>{const data=details(request);if(data)record({event:'finished',...data,elapsed:Math.round(performance.now()-(requests.get(request)??performance.now()))});});
 page.on('requestfailed',request=>{const data=details(request);if(data)record({event:'failed',...data,elapsed:Math.round(performance.now()-(requests.get(request)??performance.now()))});});
 page.on('pageerror',()=>record({event:'pageerror'}));
 return {events,stage:(stage:string)=>record({stage})};
}

export async function waitForInitialSession(page:Page,origin:string,report:(details:string)=>void) {
 const trace=portalTrace(page);
 let stage='initial navigation';
 try {
  trace.stage(stage);await page.goto(`${origin}/account`);
  stage='initial signed-in screen';trace.stage(stage);
  await page.getByText('You are signed in to Waitron Cloud.').waitFor();
 } catch(error) {
  // A broken page must not make failure reporting wait indefinitely or expose its content.
  let timer:ReturnType<typeof setTimeout>|undefined;
  const snapshot=await Promise.race([
   page.evaluate(()=>{
    const heading=document.querySelector('h1')?.textContent?.trim();
    return {heading:heading===undefined?'absent':['Your account','Sign in','Tu cuenta','Inicia sesión'].includes(heading)?heading:'other',clock:new Date().toISOString()};
   }).catch(()=>({unavailable:true})),
   new Promise<{unavailable:true}>(resolve=>{timer=setTimeout(()=>resolve({unavailable:true}),250);}),
  ]).finally(()=>clearTimeout(timer));
  try {report(JSON.stringify({stage,browser:trace.events,snapshot}));} catch {}
  throw error;
 }
}
