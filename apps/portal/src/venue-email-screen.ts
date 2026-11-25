import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
import type {VenueEmailSettings} from './remote-types.ts';

export function venueEmailScreen(app:PortalApp,settings:VenueEmailSettings,disabled:boolean){
 const c=app.copy,result=app.remote.venueEmailResult;
 const save=(event:SubmitEvent)=>{
  event.preventDefault();
  const replyTo=new FormData(event.currentTarget as HTMLFormElement).get('replyTo');
  if(typeof replyTo==='string')void app.remote.saveVenueEmail(replyTo);
 };
 return html`<section aria-labelledby="venue-email-title">
  <h5 id="venue-email-title">${c.venueEmailTitle}</h5>
  <div class="venue-email-options">
   <div><h6>${c.venueEmailOwn}</h6><p class="help">${c.venueEmailOwnHelp}</p></div>
   <form class="business-choice" method="post" action="/api/account/venue-email/save" @submit=${save}>
    <h6>${c.venueEmailWaitron}</h6><p class="help">${c.venueEmailWaitronHelp}</p>
    <label for="venue-email-reply">${c.venueEmailReply}</label>
    <input id="venue-email-reply" name="replyTo" type="email" autocomplete="email" required maxlength="254"
     .value=${settings.replyTo??''} ?disabled=${disabled}>
    <wt-button .disabled=${disabled} @click=${(event:MouseEvent)=>(event.currentTarget as HTMLElement).closest('form')?.requestSubmit()}>
     ${c.venueEmailSave}</wt-button>
    <p role="status">${result==='saved'?c.venueEmailSaved:nothing}</p>
    ${result==='invalid'||result==='failed'?html`<p role="alert">${result==='invalid'?c.venueEmailInvalid:c.venueEmailFailed}</p>`:nothing}
   </form>
  </div>
 </section>`;
}
