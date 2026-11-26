import {permissionActions} from './permission-actions.ts';
import {accountActionProofScreen} from './account-action-proof-screen.ts';
import {formatDateTime} from './dates.ts';
import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
export function backupScreen(app:PortalApp,venueId:string){
 const c=app.copy,b=app.backups;
 if(b.venueId!==venueId)return html`<wt-button .disabled=${app.installations.pending} @click=${()=>{void b.open(venueId);}}>${c.viewSnapshots}</wt-button>`;
 const selected=b.page?.points.find(p=>p.id===b.selected),disabled=app.installations.pending||b.pending||b.downloading||!!b.waiting;
 const states={pending:c.snapshotPending,verified:c.snapshotVerified,failed:c.snapshotFailed};
 const date=(s:string)=>formatDateTime(s,app.locale);
 const exit=b.page?.exitRecovery;
 return html`<section aria-label=${c.snapshotHistory}><h4>${c.snapshotHistory}</h4>
  <p>${c.snapshotPurpose}</p><p>${c.recoveryUnavailable}</p>
  ${exit?html`<dl><dt>${c.snapshotServiceEnded}</dt><dd><time datetime=${exit.effectiveEndAt}>${formatDateTime(exit.effectiveEndAt,app.locale,'UTC')}</time></dd>
   <dt>${c.snapshotDownloadDeadline}</dt><dd><time datetime=${exit.deadlineAt}>${formatDateTime(exit.deadlineAt,app.locale,'UTC')}</time></dd></dl>
   ${exit.expired?html`<p role="status">${c.snapshotDownloadsEnded}</p>`:html`<p>${c.snapshotFiscalWarning}</p>`}`:nothing}
  ${b.error?html`<p role="alert">${c[b.error]}</p>`:nothing}${permissionActions(app,b.error)}
  ${b.pending||b.downloading?html`<p role="status">${c.wait}</p>`:nothing}
  ${b.waiting?html`<p role="status">${c.snapshotRetry}</p>`:nothing}
  ${b.page&&!b.page.points.length?html`<p>${c.noSnapshots}</p>`:nothing}
  ${b.page?.points.length?html`<div class="business-choice"><label for="snapshot-choice">${c.chooseSnapshot}</label><select id="snapshot-choice" ?disabled=${disabled} @change=${(e:Event)=>b.select((e.target as HTMLSelectElement).value)}>${b.page.points.map(p=>html`<option value=${p.id} .selected=${p.id===b.selected}>${date(p.capturedAt)} · ${states[p.verification]} · ${p.id.slice(0,8)}</option>`)}</select></div>`:nothing}
  ${selected?html`<dl><dt>${c.snapshotCaptured}</dt><dd><time datetime=${selected.capturedAt}>${date(selected.capturedAt)}</time></dd><dt>${c.snapshotCheck}</dt><dd>${states[selected.verification]}</dd>
    <dt>${c.snapshotRetention}</dt><dd>${selected.retention==='daily'?c.snapshotDaily:c.snapshotMonthly}</dd><dt>${c.snapshotExpiry}</dt><dd><time datetime=${selected.expiresAt}>${date(selected.expiresAt)}</time></dd>
    <dt>${c.snapshotIdentifier}</dt><dd>${selected.id}</dd></dl>
    <p>${selected.verification==='verified'?c.snapshotDataChecked:selected.verification==='failed'?c.snapshotIntegrityFailed:c.snapshotCheckUnavailable}</p>
    ${selected.protection?html`<p>${selected.protection==='recovery'?c.snapshotRecoveryHold:c.snapshotFallback}</p>`:nothing}`:nothing}
  <p class="help">${c.snapshotRetentionHelp}</p>
  ${b.downloadable?html`<p>${c.snapshotLaterChanges}</p><div class="snapshot-actions">
   <wt-button .disabled=${disabled||app.actionProof.pending} @click=${()=>{void app.downloadBackup('download-database');}}>${c.snapshotDownloadDatabase}</wt-button>
   <wt-button .disabled=${disabled||app.actionProof.pending} @click=${()=>{void app.downloadBackup('download');}}>${c.snapshotDownload}</wt-button>
   <wt-button .disabled=${disabled||app.actionProof.pending} @click=${()=>{void app.downloadBackup('download-key');}}>${c.snapshotDownloadKey}</wt-button>
   <wt-button .disabled=${disabled||app.actionProof.pending} @click=${()=>{void app.downloadBackup('download-manifest');}}>${c.snapshotDownloadManifest}</wt-button></div>
   ${b.downloadProof?(b.error==='pairEnrollment'?html`<a href="/account" @click=${(event:MouseEvent)=>app.openAccountSecurity(event)}>${c.accountSecurity}</a>`:accountActionProofScreen(app)):nothing}`:nothing}
  <div class="snapshot-actions"><wt-button .disabled=${disabled} @click=${()=>{void b.load();}}>${c.latestSnapshots}</wt-button>
   ${b.page?.nextCursor?html`<wt-button .disabled=${disabled} @click=${()=>{void b.load(true);}}>${c.olderSnapshots}</wt-button>`:nothing}
   <wt-button @click=${()=>{b.close();app.recovery.choose(undefined);app.draw();}}>${c.closeSnapshots}</wt-button></div>
 </section>`;
}
