import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
import {permissionActions} from './permission-actions.ts';

export function billingScreen(app:PortalApp){
 const controller=app.billing,c=app.copy,venue=controller.venue,disabled=controller.pending||!!controller.waiting;
 if(!controller.loaded&&!controller.error)return nothing;
 const levels={registered:c.billingRegistered,connected:c.billingConnected,hosted:c.billingHosted};
 const end=venue?.trial?new Date(venue.trial.endsOn+'T00:00:00Z'):undefined;
 if(end)end.setUTCDate(end.getUTCDate()-1);
 return html`<section aria-label=${c.billingTitle}><h2>${c.billingTitle}</h2><p>${c.billingIntro}</p>
  ${controller.error?html`<p role="alert">${c[controller.error]}</p>`:nothing}${permissionActions(app,controller.error)}
  ${controller.venues.length>1?html`<div class="business-choice"><label for="billing-venue">${c.billingVenue}</label><select id="billing-venue" ?disabled=${controller.pending} @change=${(event:Event)=>controller.select((event.target as HTMLSelectElement).value)}>${controller.venues.map((item,index)=>html`<option value=${item.venueId} .selected=${item.venueId===controller.selected}>${c.billingVenue} ${index+1} · ${item.venueId.slice(0,8)}</option>`)}</select></div>`:nothing}
  ${venue?html`<dl><dt>${c.billingVenue}</dt><dd class="venue-id">${venue.venueId}</dd><dt>${c.billingLevel}</dt><dd>${levels[venue.level]}</dd>
    ${end?html`<dt>${c.billingLastDay}</dt><dd><time datetime=${end.toISOString().slice(0,10)}>${new Intl.DateTimeFormat(app.locale==='en'?'en-GB':'es',{dateStyle:'long',timeZone:'UTC'}).format(end)}</time></dd>`:nothing}</dl>
   ${venue.canStartTrial?html`<wt-button .disabled=${disabled} .loading=${controller.pending} @click=${()=>{void controller.start();}}>${c.billingStart}</wt-button>`:!venue.trial?html`<p>${c.billingIneligible}</p>`:nothing}`:controller.loaded?html`<p>${c.billingEmpty}</p>`:nothing}
  <wt-button .disabled=${disabled} @click=${()=>{void controller.load();}}>${c.billingRefresh}</wt-button>
 </section>`;
}
