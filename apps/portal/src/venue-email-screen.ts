import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
import type {VenueEmailSettings} from './remote-types.ts';

export function venueEmailScreen(app:PortalApp,settings:VenueEmailSettings,disabled:boolean){
 const c=app.copy,result=app.remote.venueEmailResult;
 const persist=async(form:HTMLFormElement,replyTo:string)=>{
  await app.remote.saveVenueEmail(replyTo);
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
   <form class="business-choice" method="post" action="/api/account/venue-email/save" aria-labelledby="venue-email-waitron" @submit=${save}>
    <h6 id="venue-email-waitron">${c.venueEmailWaitron}</h6><p class="help">${c.venueEmailWaitronHelp}</p>
    <label for="venue-email-reply">${c.venueEmailReply}</label>
    <input id="venue-email-reply" name="replyTo" type="email" autocomplete="email" required maxlength="254"
     autocapitalize="none" autocorrect="off" spellcheck="false" .value=${settings.replyTo??''} ?readonly=${disabled}
     aria-invalid=${result==='invalid'?'true':nothing} aria-describedby=${result==='invalid'?'venue-email-refusal':nothing}
     @input=${()=>app.remote.editVenueEmail()}>
    <wt-form-actions>
     <wt-button .disabled=${disabled} @click=${(event:MouseEvent)=>(event.currentTarget as HTMLElement).closest('form')?.requestSubmit()}>
      ${c.venueEmailSave}</wt-button>
     ${settings.replyTo?html`<wt-button .disabled=${disabled} @click=${(event:MouseEvent)=>{
      const form=(event.currentTarget as HTMLElement).closest('form');if(form)void persist(form,'');
     }}>${c.venueEmailReset}</wt-button>`:nothing}
    </wt-form-actions>
    <p role="status">${result==='saved'?c.venueEmailSaved:result==='cleared'?c.venueEmailCleared:nothing}</p>
    ${result==='invalid'||result==='failed'?html`<p id="venue-email-refusal" role="alert">${result==='invalid'?c.venueEmailInvalid:c.venueEmailFailed}</p>`:nothing}
   </form>
  </div>
 </section>`;
}
