import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
import {permissionActions} from './permission-actions.ts';
import './billing-card.ts';
import {submitOnEnter} from '@waitron-io/ui-core/submit-on-enter';
import type {LitElement} from 'lit';

export function billingScreen(app:PortalApp){
 const controller=app.billing,c=app.copy,venue=controller.venue,disabled=controller.pending||!!controller.waiting;
 if(!controller.loaded&&!controller.error)return nothing;
 const methodError=controller.error&&(controller.error.startsWith('billingMethod')||['pairEnrollment','actionProofUnavailable','billingProofRequired'].includes(controller.error));
 const draft=controller.taxDraft;
 const saveTax=async()=>{
  await controller.saveTax();
  if(controller.taxInvalid){
   const field=app.root.querySelector<LitElement>('wt-input[name="billingTax-'+controller.taxInvalid+'"]');
   await field?.updateComplete;field?.shadowRoot?.querySelector<HTMLInputElement>('input')?.focus();
  }
 };
 const levels={registered:c.billingRegistered,connected:c.billingConnected,hosted:c.billingHosted};
 const end=venue?.trial?new Date(venue.trial.endsOn+'T00:00:00Z'):undefined;
 if(end)end.setUTCDate(end.getUTCDate()-1);
 const price=venue?.connectedPrice;
 let monthlyPrice:string|undefined;
 if(price){
  const euros=new Intl.NumberFormat(app.locale==='en'?'en-GB':'es-ES',{style:'currency',currency:price.currency});
  monthlyPrice=c.billingMonthlyPrice.replace('{net}',euros.format(price.netCents/100)).replace('{total}',euros.format(price.grossCents/100));
 }
 return html`<section aria-label=${c.billingTitle}><h2>${c.billingTitle}</h2><p>${c.billingIntro}</p>
  ${controller.error&&!methodError?html`<p role="alert">${c[controller.error]}</p>`:nothing}${permissionActions(app,controller.error)}
  ${controller.venues.length>1?html`<div class="business-choice"><label for="billing-venue">${c.billingVenue}</label><select id="billing-venue" ?disabled=${controller.pending} @change=${(event:Event)=>controller.select((event.target as HTMLSelectElement).value)}>${controller.venues.map((item,index)=>html`<option value=${item.venueId} .selected=${item.venueId===controller.selected}>${c.billingVenue} ${index+1} · ${item.venueId.slice(0,8)}</option>`)}</select></div>`:nothing}
  ${venue?html`<dl><dt>${c.billingVenue}</dt><dd class="venue-id">${venue.venueId}</dd><dt>${c.billingLevel}</dt><dd>${levels[venue.level]}</dd>
    ${end?html`<dt>${c.billingLastDay}</dt><dd><time datetime=${end.toISOString().slice(0,10)}>${new Intl.DateTimeFormat(app.locale==='en'?'en-GB':'es',{dateStyle:'long',timeZone:'UTC'}).format(end)}</time></dd>`:nothing}</dl>
   ${monthlyPrice?html`<p>${monthlyPrice}</p>`:nothing}
   ${price&&price.netCents>0?html`<p>${c.billingFirstCharge}</p>`:nothing}
   ${venue.canStartTrial?html`<wt-button .disabled=${disabled} .loading=${controller.pending} @click=${()=>{void controller.start();}}>${c.billingStart}</wt-button>`:!venue.trial?html`<p>${c.billingIneligible}</p>`:nothing}`:controller.loaded?html`<p>${c.billingEmpty}</p>`:nothing}
  <wt-button .disabled=${disabled} @click=${()=>{void controller.load();}}>${c.billingRefresh}</wt-button>
  ${draft?html`<form id="billing-tax-form" method="post" action="/api/account/billing/tax/save" aria-labelledby="billing-tax-title"
    @submit=${(event:SubmitEvent)=>{event.preventDefault();void saveTax();}}>
   <h3 id="billing-tax-title">${c.billingTaxTitle}</h3><p>${c.billingTaxIntro}</p><p class="help">${c.billingTaxLimits}</p>
   ${([
    ['legalName',c.billingTaxName,c.billingTaxNameHint,200,'organization'],
    ['address',c.billingTaxAddress,c.billingTaxAddressHint,600,'billing address-line1'],
    ['taxNumber',c.billingTaxNumber,c.billingTaxNumberHint,32,'off']
   ] as const).map(([field,label,hint,limit,autocomplete])=>html`<wt-input name=${'billingTax-'+field} .label=${label} .hint=${hint} .value=${draft[field]}
     .required=${true} .maxlength=${limit} .autocomplete=${autocomplete} .spellcheck=${field!=='taxNumber'} .autocorrect=${field!=='taxNumber'} .autocapitalize=${field==='taxNumber'?'none':''} .disabled=${disabled}
     .error=${controller.taxInvalid===field?c.billingTaxInvalid:''}
     @wt-change=${(event:CustomEvent<{value:string}>)=>controller.editTax(field,event.detail.value)}
     @keydown=${(event:KeyboardEvent)=>submitOnEnter(event,app.root.querySelector('#billing-tax-save'))}></wt-input>`)}
   <wt-button id="billing-tax-save" .disabled=${disabled} .loading=${controller.pending}
     @click=${()=>app.root.querySelector<HTMLFormElement>('#billing-tax-form')?.requestSubmit()}>${c.billingTaxSave}</wt-button>
   ${controller.taxSaved?html`<p role="status">${c.billingTaxSaved}</p>`:nothing}
  </form>`:nothing}
  ${venue?.paymentMethods?html`<section class="billing-methods" aria-label=${c.billingMethodsTitle}><h3>${c.billingMethodsTitle}</h3>
   ${controller.error&&methodError?html`<p role=${controller.error==='billingProofRequired'?'status':'alert'}>${c[controller.error]}</p>`:nothing}
   ${controller.error==='pairEnrollment'?html`<a href="#account-security-heading" @click=${(event:MouseEvent)=>{event.preventDefault();app.root.querySelector<HTMLElement>('#account-security-heading')?.focus();}}>${c.accountSecurity}</a>`:controller.error==='actionProofUnavailable'||controller.error==='billingProofRequired'?html`<a href="#action-proof-heading" @click=${(event:MouseEvent)=>{event.preventDefault();app.root.querySelector<HTMLElement>('#action-proof-heading')?.focus();}}>${c.actionProofTitle}</a>`:nothing}
   <p>${c.billingMethodsIntro}</p><p>${c.billingSelectedMethod} ${venue.paymentMethods.selected==='card'?c.billingMethodCard:venue.paymentMethods.selected==='direct_debit'?c.billingMethodDebit:c.billingMethodNone}</p>
   <div class="factor-actions"><wt-button .disabled=${disabled} @click=${()=>{void app.startPaymentMethod('card');}}>${c.billingAddCard}</wt-button>
   <wt-button .disabled=${disabled} @click=${()=>{void app.startPaymentMethod('direct_debit');}}>${c.billingAddDebit}</wt-button></div>
   ${(controller.methodState??venue.paymentMethods.setup?.state)==='pending'?html`<p role="status">${c.billingMethodPending}</p>`:nothing}
   ${(controller.methodState??venue.paymentMethods.setup?.state)==='failed'?html`<p role="status">${c.billingMethodFailed}</p>`:nothing}
   ${(controller.methodState??venue.paymentMethods.setup?.state)==='verified'?html`<p role="status">${c.billingMethodVerified}</p>`:nothing}
   ${controller.methodCheckout?html`<billing-card .checkoutId=${controller.methodCheckout} .locale=${app.locale} @method-result=${()=>{void controller.verifyMethod();}} @widget-unavailable=${()=>{controller.error='billingMethodUncertain';app.draw();}}></billing-card>`:nothing}
   <wt-button .disabled=${disabled} @click=${()=>{void controller.verifyMethod();}}>${c.billingMethodRefresh}</wt-button>
  </section>`:nothing}
 </section>`;
}
