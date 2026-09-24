import {remoteScreen} from './remote-screen.ts';
import {alertScreen,monitoringScreen} from './alert-screen.ts';
import {backupScreen} from './backup-screen.ts';
import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
export function installationScreen(app:PortalApp){
 const c=app.copy,controller=app.installations,disabled=controller.pending||!!controller.waiting;
 const date=(v:string|null)=>v?html`<time datetime=${v}>${new Date(v).toLocaleString(app.locale)}</time>`:c.neverContacted;
 const labels={remote_access:c.remoteAccess,continuous_backup:c.continuousBackup,retained_snapshots:c.retainedSnapshots};
 const states={unconfigured:c.serviceUnconfigured,provisioning:c.serviceProvisioning,ready:c.serviceReady,failed:c.serviceFailed};
 const health={unknown:c.healthUnknown,healthy:c.healthHealthy,degraded:c.healthDegraded,failed:c.healthFailed};
 return html`${alertScreen(app)}<section aria-label=${c.installations}><h2>${c.installations}</h2>
  ${controller.error?html`<p role="alert">${c[controller.error]}</p>`:nothing}
  ${!controller.loaded?html`<p role="status">${c.wait}</p>`:!controller.installations.length&&!controller.error?html`<p>${c.noInstallations}</p>`:nothing}
  ${controller.organisations.length>1?html`<div class="business-choice"><label for="venue-organisation">${c.chooseOrganisation}</label><select id="venue-organisation" .value=${controller.selectedOrganisation??''} ?disabled=${controller.pending} @change=${(e:Event)=>controller.selectOrganisation((e.target as HTMLSelectElement).value)}>${controller.organisations.map(o=>html`<option value=${o.id}>${o.name}</option>`)}</select></div>`:controller.organisations.length?html`<p>${controller.organisations[0]!.name}</p>`:nothing}
  ${controller.visible.map(i=>html`<article class="installation"><h3>${i.overview?.businessName??i.legalBusinessId} · ${i.venueId.slice(0,8)}</h3><p>${i.environment==='test'?c.pairTest:c.pairProduction}${i.overview?.countryCode?html` · ${i.overview.countryCode}`:nothing}</p>
    <dl><dt>${c.pairVenue}</dt><dd class="venue-id">${i.venueId}</dd></dl>
    <p role="status">${i.revokedAt?c.accessStopped:!i.lastContactAt?c.accessPending:!i.leaseExpiresAt||Date.parse(i.leaseExpiresAt)<=Date.now()||Date.parse(i.lastContactAt)<Date.now()-300000?c.accessStale:c.accessActive}</p>
    <dl><dt>${c.lastContact}</dt><dd>${date(i.lastContactAt)}</dd><dt>${c.accessExpires}</dt><dd>${date(i.leaseExpiresAt)}</dd>
      ${i.services.map(s=>html`<dt>${labels[s.service]}</dt><dd>${states[s.state]} · ${health[!i.revokedAt&&s.observedAt&&Date.parse(s.observedAt)>Date.now()-300000?s.health:'unknown']}</dd>`)}</dl>
    ${i.overview?html`<dl><dt>${c.latestSnapshot}</dt><dd>${i.overview.latestSnapshotAt?date(i.overview.latestSnapshotAt):c.noSnapshot}</dd><dt>${c.verifiedSnapshot}</dt><dd>${i.overview.verifiedSnapshotAt?date(i.overview.verifiedSnapshotAt):c.noVerifiedSnapshot}</dd></dl>
      ${i.overview.verifiedSnapshotAt&&Date.parse(i.overview.verifiedSnapshotAt)<Date.now()-172800000?html`<p>${c.snapshotOld}</p>`:nothing}`:nothing}
    ${i.canRevoke&&!i.revokedAt?remoteScreen(app,i.installationId):nothing}
    ${monitoringScreen(app,i)}
    ${i.canRevoke?backupScreen(app,i.venueId):nothing}
    ${controller.confirming===i.installationId?html`<div role="group" aria-label=${c.stopAccess}><p>${c.stopHelp}</p>
      <wt-form-actions><wt-button .disabled=${controller.pending} @click=${()=>controller.choose()}>${c.cancelStop}</wt-button><wt-button .disabled=${disabled} @click=${()=>{void controller.revoke();}}>${c.confirmStop}</wt-button></wt-form-actions></div>`
      :i.canRevoke&&!i.revokedAt?html`<wt-button .disabled=${disabled} @click=${()=>controller.choose(i.installationId)}>${c.stopAccess}</wt-button>`:nothing}
  </article>`)}
  <wt-button .disabled=${disabled} @click=${()=>{void controller.load();}}>${c.refreshStatus}</wt-button>
 </section>`;
}
