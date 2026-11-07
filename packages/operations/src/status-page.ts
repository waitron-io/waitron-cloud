const states={
 investigating:['Investigating','Investigando'],
 fix_being_applied:['Fix being applied','Aplicando una solución'],
 monitoring:['Monitoring','En observación'],
 resolved:['Resolved','Resuelto'],
} as const;
const services={
 cloud:['Waitron Cloud','Waitron Cloud'],
 remote_access:['Remote access','Acceso remoto'],
 backups:['Backups','Copias de seguridad'],
 email:['Email','Correo electrónico'],
 hosted_servers:['Cloud-hosted venue servers','Servidores de locales alojados en Cloud'],
} as const;
const impacts={
 some:['Some venues are affected.','Algunos locales se ven afectados.'],
 all:['All venues are affected.','Todos los locales se ven afectados.'],
 unknown:['The impact is not yet known.','Aún no se conoce el alcance.'],
} as const;
const resolvedImpacts={some:['Some venues were affected.','Algunos locales se vieron afectados.'],all:['All venues were affected.','Todos los locales se vieron afectados.'],unknown:impacts.unknown} as const;
const css=`
:root{color-scheme:light dark;--bg:#f4f5f2;--card:#fff;--text:#20342c;--muted:#4d6057;--line:#cbd5ce;--accent:#25634b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:18px/1.6 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:48px 24px}header{display:flex;gap:24px;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:20px}
.brand{font-weight:750;letter-spacing:-.02em}a{color:var(--accent);text-underline-offset:4px}a:focus-visible{outline:3px solid var(--accent);outline-offset:5px}
article{margin-top:36px;padding:32px;border:1px solid var(--line);border-radius:16px;background:var(--card)}h1{font-size:clamp(1.6rem,5vw,2.25rem);line-height:1.25;letter-spacing:-.025em;margin:0 0 24px}
p{margin:12px 0}.service{font-weight:650}.time{font-size:.94rem;color:var(--muted)}time{white-space:normal}
@media(prefers-color-scheme:dark){:root{--bg:#14211c;--card:#1c2f26;--text:#edf5ef;--muted:#c0d0c6;--line:#486154;--accent:#9fdbba}}
@media(max-width:480px){main{padding:24px 16px}article{padding:24px 20px;margin-top:24px}header{gap:12px}}
`;
type Incident={state:keyof typeof states;service:keyof typeof services;impact:keyof typeof impacts;updatedAt:string};
type Status=Incident|{state:'no_incident';updatedAt:string};
function invalid():never{throw new Error('Invalid public status input');}
function parse(input:unknown):Status{
 if(!input||typeof input!=='object'||Array.isArray(input))invalid();
 const value=input as Record<string,unknown>;
 const keys=value.state==='no_incident'?['state','updatedAt']:['state','service','impact','updatedAt'];
 if(Object.keys(value).length!==keys.length||!keys.every(key=>Object.hasOwn(value,key)))invalid();
 if(value.state!=='no_incident'&&(typeof value.state!=='string'||!Object.hasOwn(states,value.state)||typeof value.service!=='string'||!Object.hasOwn(services,value.service)||typeof value.impact!=='string'||!Object.hasOwn(impacts,value.impact)))invalid();
 if(typeof value.updatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value.updatedAt))invalid();
 const date=new Date(value.updatedAt),next=new Date(date.getTime()+30*60_000);
 if(!Number.isFinite(date.getTime())||date.toISOString().replace('.000Z','Z')!==value.updatedAt||!Number.isFinite(next.getTime())||next.getUTCFullYear()>9999)invalid();
 return value as Status;
}
const display=(timestamp:string)=>timestamp.replace('T',' ').replace('Z',' UTC');
const time=(timestamp:string)=>`<time datetime="${timestamp}">${display(timestamp)}</time>`;

export function renderStatusPage(input:unknown):{'index.html':string;'es/index.html':string}{
 const value=parse(input);
 const render=(language:0|1)=>{
  const en=language===0;
  const heading=value.state==='no_incident'
   ?['Status updates are being set up. Current service health is unverified.','Las actualizaciones de estado están en preparación. El estado actual del servicio no está verificado.'][language]
   :states[value.state][language];
  const update=`<p class="time">${value.state==='resolved'?(en?'Resolved at':'Resuelto el'):(en?'Updated':'Actualizado')}: ${time(value.updatedAt)}</p>`;
  // Only closed vocabulary and validated UTC timestamps may enter public HTML.
  const content=value.state==='no_incident'
   ?`<p>${en?'No incident reported.':'No hay incidencias notificadas.'}</p>${update}`
   :`<p class="service">${services[value.service][language]}</p><p>${(value.state==='resolved'?resolvedImpacts:impacts)[value.impact][language]}</p>${update}${value.state==='resolved'?'':`<p class="time">${en?'Next update by':'Próxima actualización antes de'}: ${time(new Date(Date.parse(value.updatedAt)+30*60_000).toISOString().replace('.000Z','Z'))}</p>`}`;
  return `<!doctype html>\n<html lang="${en?'en':'es'}">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Waitron Cloud · ${en?'Service status':'Estado del servicio'}</title><style>${css}</style></head>\n<body><main><header><span class="brand">Waitron Cloud</span><nav aria-label="${en?'Language':'Idioma'}"><a href="${en?'es/index.html':'../index.html'}" hreflang="${en?'es':'en'}" lang="${en?'es':'en'}">${en?'Español':'English'}</a></nav></header><article><h1>${heading}</h1>${content}</article></main></body>\n</html>\n`;
 };
 return {'index.html':render(0),'es/index.html':render(1)};
}
