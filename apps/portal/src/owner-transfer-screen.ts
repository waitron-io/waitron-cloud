import {html,nothing} from 'lit';
import {submitOnEnter} from '@waitron-io/ui-core/submit-on-enter';
import type {PortalApp} from './app.ts';
export function ownerTransferScreen(app:PortalApp){
 const t=app.transfers,c=app.copy,busy=t.pending||!!t.waiting;
 return html`<section id="owner-transfer-section" aria-labelledby="owner-transfer-heading"><h2 id="owner-transfer-heading" tabindex="-1">${c.transferTitle}</h2>
  <p>${c.transferIntro}</p>${t.error?html`<p role="alert">${c[t.error]}</p>`:nothing}
  <p><wt-button .disabled=${busy} @click=${()=>{void t.load();}}>${c.transferRefresh}</wt-button></p>
  ${t.data.organisations.length?html`<label class="business-choice">${c.transferBusiness}<select name="ownerTransferOrganisation" aria-label=${c.transferBusiness} .value=${t.organisationId} ?disabled=${busy}
    @change=${(e:Event)=>{t.organisationId=(e.target as HTMLSelectElement).value;app.draw();}}>${t.data.organisations.map(org=>html`<option value=${org.id}>${org.name}</option>`)}</select></label>
   <wt-input name="ownerTransferEmail" .label=${c.transferEmail} .type=${'email'} .autocomplete=${'email'} .value=${t.email} .disabled=${busy}
    @wt-change=${(e:CustomEvent<{value:string}>)=>{t.email=e.detail.value;app.draw();}}
    @keydown=${(e:KeyboardEvent)=>submitOnEnter(e,app.root.querySelector('#owner-transfer-create'))}></wt-input>
   <wt-button id="owner-transfer-create" .disabled=${busy} @click=${()=>{void app.transferOwnership('create');}}>${c.transferSend}</wt-button>`:nothing}
  <ul>${t.data.offers.map(offer=>{
   const state=offer.state==='pending'&&Date.parse(offer.expiresAt)<=Date.now()?'expired':offer.state;
   return html`<li class="installation"><strong>${offer.organisationName}</strong>
    ${offer.businessNames?.length?html`<ul>${offer.businessNames.map(name=>html`<li>${name}</li>`)}</ul>`:nothing}<dl><dt>${c.transferFrom}</dt><dd>${offer.senderEmail}</dd><dt>${c.transferTo}</dt><dd>${offer.recipientEmail}</dd></dl>
    <p>${c[state==='pending'?'transferPending':state==='accepted'?'transferAccepted':state==='cancelled'?'transferCancelled':'transferExpired']}</p>
    <p>${c.transferExpiry} ${new Intl.DateTimeFormat(app.locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(offer.expiresAt))}</p>
    ${state==='pending'?html`<div class="snapshot-actions">${offer.incoming?html`<wt-button .disabled=${busy} @click=${()=>{void app.transferOwnership('accept',offer.id);}}>${c.transferAccept}</wt-button>`:nothing}
     <wt-button .disabled=${busy} @click=${()=>{void app.transferOwnership('cancel',offer.id);}}>${c.transferCancel}</wt-button></div>`:nothing}</li>`;
  })}</ul></section>`;
}
