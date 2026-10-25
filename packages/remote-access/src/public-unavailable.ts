import {createHash} from 'node:crypto';

const style=`:root{color-scheme:light dark;font-family:system-ui,sans-serif;color:#111827;background:#f7f8fa}*{box-sizing:border-box}body{margin:0;min-height:100svh;background:#f7f8fa;display:grid;place-items:center;padding:24px}main{width:100%;max-width:480px;padding:32px;border:1px solid #d1d5db;border-radius:16px;background:#fff}h1{font-size:clamp(1.5rem,5vw,2rem);line-height:1.2;margin:0 0 16px}p{line-height:1.6;margin:0 0 24px;color:#4b5563}a{display:inline-block;padding:12px 20px;background:#1d4ed8;color:#fff;border-radius:8px;text-decoration:none;font-weight:600}a:hover{background:#1e40af}a:focus-visible{outline:3px solid #111827;outline-offset:4px}@media(prefers-color-scheme:dark){:root{color:#f9fafb;background:#111827}body{background:#111827}main{background:#1f2937;border-color:#4b5563}p{color:#d1d5db}a{background:#93c5fd;color:#111827}a:hover{background:#bfdbfe}a:focus-visible{outline-color:#f9fafb}}`;
const policy=`default-src 'none'; style-src 'sha256-${createHash('sha256').update(style).digest('base64')}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;

function preferences(header:string|undefined){
 return (header??'').split(',').map(part=>{
  const [value,...parameters]=part.trim().toLowerCase().split(';');
  const quality=parameters.map(p=>p.trim()).find(p=>p.startsWith('q='));
  const q=quality===undefined?1:Number(quality.slice(2));
  return {value:value!.trim(),q:Number.isFinite(q)&&q>=0&&q<=1?q:0};
 });
}

export function publicUnavailable(accept:string|undefined,language:string|undefined){
 const types=preferences(accept);
 const json=types.find(p=>p.value==='application/json')?.q??types.find(p=>p.value==='application/*')?.q??0;
 const html=types.find(p=>p.value==='text/html')?.q??types.find(p=>p.value==='text/*')?.q??types.find(p=>p.value==='*/*')?.q??0;
 const headers:Record<string,string>={'Retry-After':'30','Vary':'Accept, Accept-Language'};
 if(json>0&&json>=html)return {body:JSON.stringify({error:'venue_unavailable'}),type:'application/json',headers};
 const locale=preferences(language).filter(p=>p.q>0).sort((a,b)=>b.q-a.q).map(p=>p.value.split('-')[0]).find(value=>value==='en'||value==='es')??'en';
 const text=locale==='es'?{title:'Local no disponible',message:'La página de este local no está disponible. Puedes volver a intentarlo.',retry:'Volver a intentar'}:{title:'Venue unavailable',message:'This venue’s page is unavailable. You can try again.',retry:'Try again'};
 headers['Content-Language']=locale;headers['Content-Security-Policy']=policy;
 return {body:`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${text.title}</title><style>${style}</style></head><body><main><h1>${text.title}</h1><p>${text.message}</p><a href="/public/availability">${text.retry}</a></main></body></html>`,type:'text/html; charset=utf-8',headers};
}
