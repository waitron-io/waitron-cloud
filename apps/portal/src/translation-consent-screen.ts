import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
export function translationConsentScreen(app:PortalApp,venueId:string,showReadError=false){
 const t=app.translationConsent,c=app.copy,on=t.consented(venueId),disabled=app.installations.pending||t.pending||!!t.waiting||!t.loaded;
 return html`<section role="group" aria-label=${c.translationConsent}><h4>${c.translationConsent}</h4><p class="help">${c.translationConsentHelp}</p>
  ${t.error&&(t.errorVenueId===venueId||(!t.errorVenueId&&showReadError))?html`<p role="alert">${c[t.error]}</p>`:nothing}
  ${!t.loaded?html`<wt-button .disabled=${t.pending||!!t.waiting} @click=${()=>{void t.load();}}>${c.refreshStatus}</wt-button>`:nothing}
  ${on?html`<p role="status">${c.translationConsentOn}</p>`:nothing}
  <wt-button .disabled=${disabled} @click=${()=>{void (on?t.withdraw(venueId):t.agree(venueId));}}>${on?c.translationConsentWithdraw:c.translationConsentAgree}</wt-button></section>`;
}
