import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
import type {VenueEmailSettings} from './remote-types.ts';

export function venueEmailScreen(app:PortalApp,settings:VenueEmailSettings,disabled:boolean){
 const c=app.copy,r=app.remote,result=r.venueEmailField==='replyTo'?r.venueEmailResult:undefined;
 const defaultReply=!settings.replyTo&&!!settings.domain?.address;
 const replyDescription=result==='invalid'?'venue-email-refusal':defaultReply?'venue-email-reply-default':nothing;
 const persist=async(form:HTMLFormElement,replyTo:string,field:'replyTo'|'reset'='replyTo')=>{
  await app.remote.saveVenueEmail(replyTo,field);
  if(form.isConnected&&document.activeElement===document.body)form.querySelector('input')?.focus();
 };
 const save=(event:SubmitEvent)=>{
  event.preventDefault();
  const form=event.currentTarget as HTMLFormElement,replyTo=new FormData(form).get('replyTo');
  if(typeof replyTo==='string')void persist(form,replyTo);
 };
 return html`<section aria-labelledby="venue-email-title">
  <h5 id="venue-email-title">${c.venueEmailTitle}</h5>
  <div class="venue-email-options">
   <div><h6>${c.venueEmailOwn}</h6><p class="help">${c.venueEmailOwnHelp}</p></div>
   <div>
    <form class="business-choice" method="post" action="/api/account/venue-email/save" aria-labelledby="venue-email-waitron" @submit=${save}>
     <h6 id="venue-email-waitron">${c.venueEmailWaitron}</h6><p class="help">${c.venueEmailWaitronHelp}</p>
     <label for="venue-email-reply">${c.venueEmailReply}</label>
     ${defaultReply?html`<p class="help" id="venue-email-reply-default">${c.venueEmailReplyDefault}</p>`:nothing}
     <input id="venue-email-reply" name="replyTo" type="email" autocomplete="email" maxlength="254"
      autocapitalize="none" autocorrect="off" spellcheck="false" .value=${app.remote.venueEmailDraft} ?readonly=${disabled}
      aria-invalid=${result==='invalid'?'true':nothing} aria-describedby=${replyDescription}
      @input=${(event:Event)=>app.remote.editVenueEmail((event.currentTarget as HTMLInputElement).value)}>
     <wt-form-actions>
      <wt-button .disabled=${disabled} @click=${(event:MouseEvent)=>(event.currentTarget as HTMLElement).closest('form')?.requestSubmit()}>
       ${c.venueEmailSave}</wt-button>
      ${settings.replyTo||settings.domain?.address?html`<wt-button .disabled=${disabled} @click=${(event:MouseEvent)=>{
       const form=(event.currentTarget as HTMLElement).closest('form');if(form)void persist(form,'','reset');
      }}>${c.venueEmailReset}</wt-button>`:nothing}
     </wt-form-actions>
     <p role="status">${result==='saved'?c.venueEmailSaved:result==='cleared'?c.venueEmailCleared:nothing}</p>
     ${result==='invalid'||result==='failed'?html`<p id="venue-email-refusal" role="alert">${result==='invalid'?c.venueEmailInvalid:c.venueEmailFailed}</p>`:nothing}
    </form>
    ${settings.domain?domainForm(app,disabled):nothing}
   </div>
  </div>
  ${settings.domain?.records.length?dnsRecords(app,settings.domain,disabled):nothing}
 </section>`;
}

function domainForm(app:PortalApp,disabled:boolean){
 const c=app.copy,r=app.remote,result=r.venueEmailField==='address'?r.venueEmailResult:undefined;
 return html`<form class="business-choice" method="post" action="/api/account/venue-email/save-domain" aria-labelledby="venue-email-domain" @submit=${(event:SubmitEvent)=>{
  event.preventDefault();
  const form=event.currentTarget as HTMLFormElement;
  const address=new FormData(form).get('address');
  if(typeof address==='string')void r.saveVenueEmail(address,'address');
 }}>
  <h6 id="venue-email-domain">${c.venueDomain}</h6><p class="help">${c.venueDomainHelp}</p>
  <label for="venue-email-from">${c.venueDomainAddress}</label>
  <input id="venue-email-from" name="address" type="email" autocomplete="off" required maxlength="254"
   autocapitalize="none" autocorrect="off" spellcheck="false" .value=${r.venueDomainDraft} ?readonly=${disabled}
   aria-invalid=${result==='invalid'?'true':nothing} aria-describedby=${result==='invalid'?'venue-domain-refusal':nothing}
   @input=${(event:Event)=>r.editVenueEmail((event.currentTarget as HTMLInputElement).value,'address')}>
  <wt-form-actions><wt-button .disabled=${disabled} @click=${(event:MouseEvent)=>(event.currentTarget as HTMLElement).closest('form')?.requestSubmit()}>
   ${c.venueDomainSave}</wt-button></wt-form-actions>
  <p role="status">${result==='saved'?c.venueDomainSaved:nothing}</p>
  ${result==='invalid'||result==='failed'?html`<p id="venue-domain-refusal" role="alert">${result==='invalid'?c.venueDomainInvalid:c.venueDomainFailed}</p>`:nothing}
 </form>`;
}

function dnsRecords(app:PortalApp,domain:NonNullable<VenueEmailSettings['domain']>,disabled:boolean){
 const c=app.copy;
 const feedback=(event:Event)=>(event.currentTarget as HTMLElement).closest('section')?.querySelector<HTMLElement>('.venue-dns-feedback');
 const report=(element:HTMLElement|null|undefined,message:string)=>{if(element?.isConnected)element.textContent=message;};
 const copy=async(event:Event,value:string)=>{
  const status=feedback(event);
  try{await navigator.clipboard.writeText(value);report(status,c.venueDnsCopied);}
  catch{report(status,c.venueDnsCopyFailed);}
 };
 const download=async(event:Event)=>{
  const status=feedback(event);
  try{
   const asset='/venue-dns-pdf.js';
   const {makeDnsPdf}=await import(asset) as typeof import('./venue-dns-pdf.ts');
   const bytes=Uint8Array.from(await makeDnsPdf(domain.records,c));
   if(app.remote.view?.venueEmail?.domain!==domain)return;
   const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),link=document.createElement('a');
   try{link.href=url;link.download='waitron-dns.pdf';link.click();}finally{URL.revokeObjectURL(url);}
  }catch{report(status,c.venueDnsPdfFailed);}
 };
 return html`<section aria-labelledby="venue-dns-title">
  <h6 id="venue-dns-title">${c.venueDnsRecords}</h6>
  ${domain.records.map(record=>html`<dl>
   <dt>${c.remoteRecord}</dt><dd>${record.type}</dd>
   <dt>${c.remoteRecordName}</dt><dd><span>${record.name}</span> <wt-button .disabled=${disabled} @click=${(event:Event)=>void copy(event,record.name)}>${c.venueDnsCopyName}</wt-button></dd>
   <dt>${c.remoteRecordValue}</dt><dd><span>${record.value}</span> <wt-button .disabled=${disabled} @click=${(event:Event)=>void copy(event,record.value)}>${c.venueDnsCopyTarget}</wt-button></dd>
   ${record.status?html`<dt>${c.venueDnsStatus}</dt><dd>${record.status==='verified'?html`<span aria-hidden="true">✓</span> <span>${c.venueDnsVerified}</span>`:record.status==='unverified'?c.venueDnsUnverified:c.venueDnsUnknown}</dd>`:nothing}
  </dl>`)}
  <wt-button .disabled=${disabled} @click=${download}>${c.venueDnsDownload}</wt-button>
  <p class="venue-dns-feedback" role="status"></p>
 </section>`;
}
