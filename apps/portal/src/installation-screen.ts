import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
export function installationScreen(app:PortalApp){
 const c=app.copy,controller=app.installations,disabled=controller.pending||!!controller.waiting;
 const date=(v:string|null)=>v?html`<time datetime=${v}>${new Date(v).toLocaleString(app.locale)}</time>`:c.neverContacted;
 const labels={remote_access:c.remoteAccess,continuous_backup:c.continuousBackup,retained_snapshots:c.retainedSnapshots};
 const states={unconfigured:c.serviceUnconfigured,provisioning:c.serviceProvisioning,ready:c.serviceReady,failed:c.serviceFailed};
 const health={unknown:c.healthUnknown,healthy:c.healthHealthy,degraded:c.healthDegraded,failed:c.healthFailed};
 return html`<section aria-label=${c.installations}><h2>${c.installations}</h2>
  ${controller.error?html`<p role="alert">${c[controller.error]}</p>`:nothing}
  ${!controller.loaded?html`<p role="status">${c.wait}</p>`:!controller.installations.length&&!controller.error?html`<p>${c.noInstallations}</p>`:nothing}
  ${controller.installations.map(i=>html`<article class="installation"><h3>${i.environment==='test'?c.pairTest:c.pairProduction}</h3>
    <dl><dt>${c.pairVenue}</dt><dd class="venue-id">${i.venueId}</dd></dl>
    <p role="status">${i.revokedAt?c.accessStopped:!i.lastContactAt?c.accessPending:!i.leaseExpiresAt||Date.parse(i.leaseExpiresAt)<=Date.now()||Date.parse(i.lastContactAt)<Date.now()-300000?c.accessStale:c.accessActive}</p>
    <dl><dt>${c.lastContact}</dt><dd>${date(i.lastContactAt)}</dd><dt>${c.accessExpires}</dt><dd>${date(i.leaseExpiresAt)}</dd>
      ${i.services.map(s=>html`<dt>${labels[s.service]}</dt><dd>${states[s.state]} · ${health[!i.revokedAt&&s.observedAt&&Date.parse(s.observedAt)>Date.now()-300000?s.health:'unknown']}</dd>`)}</dl>
    ${controller.confirming===i.installationId?html`<div role="group" aria-label=${c.stopAccess}><p>${c.stopHelp}</p>
      <wt-form-actions><wt-button .disabled=${controller.pending} @click=${()=>controller.choose()}>${c.cancelStop}</wt-button><wt-button .disabled=${disabled} @click=${()=>{void controller.revoke();}}>${c.confirmStop}</wt-button></wt-form-actions></div>`
      :i.canRevoke&&!i.revokedAt?html`<wt-button .disabled=${disabled} @click=${()=>controller.choose(i.installationId)}>${c.stopAccess}</wt-button>`:nothing}
  </article>`)}
  <wt-button .disabled=${disabled} @click=${()=>{void controller.load();}}>${c.refreshStatus}</wt-button>
 </section>`;
}
