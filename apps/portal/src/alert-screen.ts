import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
import type {AccountInstallation} from './installation-types.ts';
export function alertScreen(app:PortalApp){
 const a=app.alerts,c=app.copy,disabled=a.pending||!!a.waiting;
 return html`<section aria-label=${c.serviceAlerts}><h2>${c.serviceAlerts}</h2><p>${c.alertsHelp}</p>
  ${a.error?html`<p role="alert">${c[a.error]}</p>`:nothing}
  ${a.saved?html`<p role="status">${c.alertsSaved}</p>`:nothing}
  ${!a.loaded?html`<wt-button .disabled=${disabled} @click=${()=>{void a.load();}}>${c.alertsLoad}</wt-button>`:html`
   <label class="alert-choice"><input id="service-alerts-enabled" type="checkbox" .checked=${a.enabled} ?disabled=${disabled} @change=${(e:Event)=>a.choose((e.target as HTMLInputElement).checked,a.locale)}>${c.alertsReceive}</label>
   <div class="business-choice"><label for="alert-language">${c.alertsLanguage}</label><select id="alert-language" ?disabled=${disabled} @change=${(e:Event)=>a.choose(a.enabled,(e.target as HTMLSelectElement).value==='es'?'es':'en')}><option value="en" .selected=${a.locale==='en'}>English</option><option value="es" .selected=${a.locale==='es'}>Español</option></select></div>
   <wt-form-actions><wt-button .disabled=${disabled} @click=${()=>{void a.save();}}>${c.alertsSave}</wt-button></wt-form-actions>`}
 </section>`;
}
export function monitoringScreen(app:PortalApp,installation:AccountInstallation){
 const m=installation.monitoring,c=app.copy;
 if(!m?.enabled)return html`<p>${c.monitorOff}</p>`;
 const fresh=m.fresh&&m.checkedAt&&Date.parse(m.checkedAt)>Date.now()-300000;
 const copy={disconnected:c.monitorDisconnected,snapshot_stale:c.monitorSnapshotStale,verification_failed:c.monitorVerificationFailed};
 return html`<section aria-label=${c.monitoring}><h4>${c.monitoring}</h4>
  ${!fresh?html`<p role="status">${c.monitorUnknown}</p>`:!m.incidents.length?html`<p>${c.monitorNoAlerts}</p>`:nothing}
  ${m.checkedAt?html`<p>${c.monitorChecked}: <time datetime=${m.checkedAt}>${new Date(m.checkedAt).toLocaleString(app.locale)}</time></p>`:nothing}
  ${m.incidents.map(i=>html`<p>${copy[i.kind]}</p><p>${c.monitorSince}: <time datetime=${i.openedAt}>${new Date(i.openedAt).toLocaleString(app.locale)}</time></p>`)}
 </section>`;
}
