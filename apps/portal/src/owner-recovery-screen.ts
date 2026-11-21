import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
export function ownerRecoveryScreen(app:PortalApp){
 const r=app.ownerRecovery,c=app.copy,busy=r.pending||!!r.waiting;
 const button=(label:string)=>html`<wt-form-actions><wt-button id="submit" variant="primary" .disabled=${busy} .loading=${r.pending} @click=${()=>{void app.submit();}}>${label}</wt-button></wt-form-actions>`;
 return html`<section>
  ${r.error?html`<p role="alert">${c[r.error]}</p>`:nothing}
  ${r.stage==='choose'?html`<p>${c.ownerRecoveryChoose}</p>${r.venues.length?html`
   <div class="business-choice"><label for="owner-recovery-venue">${c.ownerRecoveryBox}</label><select id="owner-recovery-venue" name="ownerRecoveryVenue" .value=${r.installationId} ?disabled=${busy}
    @change=${(e:Event)=>{r.installationId=(e.target as HTMLSelectElement).value;app.draw();}}>${r.venues.map(v=>html`<option value=${v.installationId}>${v.organisationName || c.unnamedOrganisation} · ${v.businessName || c.unnamedBusiness} · ${v.venueId}</option>`)}</select></div>${button(c.ownerRecoverySelect)}`:r.error||r.pending?nothing:html`<p>${c.ownerRecoveryUnavailable}</p>`}`:nothing}
  ${r.stage==='pending'?html`<p role="status">${c.ownerRecoveryPending}</p>${button(c.ownerRecoveryCheck)}`:nothing}
  ${r.stage==='refused'?html`<p role="status">${c.ownerRecoveryRefused}</p>`:nothing}
  ${r.stage==='approved'?html`<p>${c.ownerRecoveryApproved}</p><p id="owner-recovery-password-help">${c.passwordHelp}</p>
   <wt-input name="ownerRecoveryPassword" .label=${c.newPassword} .type=${app.reveal?'text':'password'} .autocomplete=${'new-password'} .value=${r.password} .disabled=${busy} .required=${true}
    aria-describedby="owner-recovery-password-help" @wt-change=${(e:CustomEvent<{value:string}>)=>{r.password=e.detail.value;r.error=undefined;app.draw();}}>
    <button type="button" slot="end" class="reveal" aria-label=${app.reveal?c.hide:c.show} aria-pressed=${String(app.reveal)} @click=${()=>{app.readFields();app.reveal=!app.reveal;app.draw();}}>${app.reveal?c.hide:c.show}</button></wt-input>${button(c.ownerRecoveryComplete)}`:nothing}
  ${r.error||r.stage==='refused'?html`<p><a href="/forgot-password" @click=${(e:MouseEvent)=>app.follow(e,'/forgot-password')}>${c.requestLink}</a></p>`:nothing}
 </section>`;
}
