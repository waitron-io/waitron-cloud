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
