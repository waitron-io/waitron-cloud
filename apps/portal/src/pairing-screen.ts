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
  if(!p.businesses.length)return html`<p>${c.pairNoBusinesses}</p>${logout}`;
  if(p.view&&p.view.state!=='awaiting_cloud')return html`<p role="status">${p.view.state==='complete'?c.pairComplete:c.pairApproved}</p>
    <p>${p.view.organisationName}</p><p>${p.view.legalBusinessName}</p>${logout}`;
  const choice=p.businesses.find(b=>b.legalBusinessId===p.selected);
  return html`<p>${c.pairIntro}</p>
    <wt-input name="pairingCode" .label=${c.pairCode} .value=${p.code} .required=${true} .disabled=${p.pending||!!p.view}
      .error=${p.codeError?c.pairCodeError:''} autocomplete="off"
      @wt-change=${(event:CustomEvent<{value:string}>)=>{p.code=event.detail.value;}}></wt-input>
    ${p.view?html`<p>${c.pairConfirm}</p><dl><dt>${c.pairVenue}</dt><dd class="venue-id">${p.view.localVenueId}</dd></dl>
      <p>${p.view.environment==='test'?c.pairTest:c.pairProduction}</p>
      ${p.businesses.length===1?html`<p>${choice?.organisationName}</p><p>${choice?.legalBusinessName}</p>`:
        html`<label class="business-choice">${c.pairBusiness} *<select name="legalBusinessId" aria-invalid=${p.error==='pairChoice'?'true':'false'} aria-describedby="business-error" ?disabled=${p.pending}
          @change=${(event:Event)=>{p.selected=(event.target as HTMLSelectElement).value;if(p.selected&&p.error==='pairChoice')p.error=undefined;app.draw();}}>
          <option value="" .selected=${!p.selected}>${c.pairChoice}</option>${p.businesses.map(b=>html`<option value=${b.legalBusinessId} .selected=${b.legalBusinessId===p.selected}>${b.organisationName} · ${b.legalBusinessName} (${b.countryCode})</option>`)}</select></label><p id="business-error">${p.error==='pairChoice'?c.pairChoice:''}</p>`}`:nothing}
    <wt-form-actions>${logout}<wt-button id="submit" variant="primary" .disabled=${p.pending||!!p.waiting} .loading=${p.pending}
      @click=${()=>{void app.submitPairing();}}>${p.view?c.pairApprove:c.pairInspect}</wt-button></wt-form-actions>
    ${p.error==='pairSession'?html`<a href="/login" @click=${(event:MouseEvent)=>app.follow(event,'/login')}>${c.login}</a>`:nothing}`;
}
