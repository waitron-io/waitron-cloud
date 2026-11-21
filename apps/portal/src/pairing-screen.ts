import {accountActionProofScreen} from './account-action-proof-screen.ts';
import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
export function pairingScreen(app:PortalApp){
  const p=app.pairing,c=app.copy;
  if(!p.requestId||app.link.invalid)return html`<p>${c.pairMissing}</p>`;
  if(app.session.state.kind!=='authenticated')return html`<p role="status">${app.session.state.kind==='unavailable'?c.sessionUnavailable:c.checking}</p>
    ${app.session.state.kind==='unavailable'?html`<wt-button .disabled=${!!app.waiting} @click=${()=>{void app.session.check();}}>${c.retry}</wt-button>`:nothing}`;
  const logout=html`<wt-button .disabled=${app.logoutDisabled} @click=${()=>{void app.logout();}}>${c.signout}</wt-button>`;
  if(!p.loaded)return html`${p.pending?html`<p role="status">${c.pairLoading}</p>`:nothing}
    <wt-button .disabled=${p.pending||!!p.waiting} @click=${()=>{void p.load();}}>${c.retry}</wt-button>${logout}`;
  if(!p.businesses.length)return html`<p>${c.pairNoBusinesses}</p>
    <p><a href="/account">${c.businessRegister}</a></p>${logout}`;
  const view = p.view;
  const approved = view && view.state !== 'awaiting_cloud';
  const business = approved ? view : p.businesses.length === 1 ? p.businesses[0] : undefined;
  const details = view ? html`<dl class="pairing-details">
    ${view.venueName ? html`<dt>${c.pairVenueName}</dt><dd>${view.venueName}</dd>` : nothing}
    <dt>${c.pairVenue}</dt><dd class="venue-id">${view.venueId || c.pairNewVenue}</dd>
    <dt>${c.pairInstallation}</dt><dd>${view.environment === 'test' ? c.pairTest : c.pairProduction}</dd>
    ${business ? html`<dt>${c.chooseOrganisation}</dt><dd>${business.organisationName}</dd>
      <dt>${c.pairBusiness}</dt><dd>${business.legalBusinessName}</dd>` : nothing}
  </dl>` : nothing;
  if(approved)return html`<p role="status">${view.state === 'complete' ? c.pairComplete : c.pairApproved}</p>
    ${details}
    <p><a href="/account" @click=${(event:MouseEvent)=>app.follow(event,'/account')}>${c.pairBackToAccount}</a></p>
    ${logout}`;
  const proofRequested=app.actionProof.loaded||app.actionProof.pending||p.error==='pairEnrollment';
  return html`<p>${c.pairIntro}</p>
    <wt-input name="pairingCode" .label=${c.pairCode} .value=${p.code} .required=${true} .disabled=${p.pending||!!p.view}
      .error=${p.codeError?c.pairCodeError:''} autocomplete="off"
      @wt-change=${(event:CustomEvent<{value:string}>)=>{p.code=event.detail.value;p.codeError=false;if(p.error==='pairCodeError')p.error=undefined;app.draw();}}></wt-input>
    ${p.view?html`<p>${c.pairConfirm}</p>${details}
      ${p.businesses.length===1?nothing:
        html`<label class="business-choice">${c.pairBusiness} *<select name="legalBusinessId" aria-invalid=${p.error==='pairChoice'?'true':'false'} aria-describedby="business-error" ?disabled=${p.pending}
          @change=${(event:Event)=>{p.selected=(event.target as HTMLSelectElement).value;if(p.selected&&p.error==='pairChoice')p.error=undefined;app.draw();}}>
          <option value="" .selected=${!p.selected}>${c.pairChoice}</option>${p.businesses.map(b=>html`<option value=${b.legalBusinessId} .selected=${b.legalBusinessId===p.selected}>${b.organisationName} · ${b.legalBusinessName} (${b.countryCode})</option>`)}</select></label><p id="business-error">${p.error==='pairChoice'?c.pairChoice:''}</p>`}`:nothing}
    ${p.view&&proofRequested?html`${p.error==='pairEnrollment'||app.actionProof.status?.methods.every(m=>m==='email')?html`<p>${c.pairEnrollment}</p><a href="/account" @click=${(event:MouseEvent)=>app.follow(event,'/account')}>${c.accountSecurity}</a>`:accountActionProofScreen(app,2)}`:nothing}
    <wt-form-actions>${logout}<wt-button id="submit" variant="primary" .disabled=${p.pending||!!p.waiting} .loading=${p.pending}
      @click=${()=>{void app.submitPairing();}}>${p.view?c.pairApprove:c.pairInspect}</wt-button></wt-form-actions>
    ${p.error==='pairSession'?html`<a href="/login" @click=${(event:MouseEvent)=>app.follow(event,'/login')}>${c.login}</a>`:nothing}`;
}
