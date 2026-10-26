import {permissionActions} from './permission-actions.ts';
import {formatDateTime} from './dates.ts';
import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
export function backupScreen(app:PortalApp,venueId:string){
 const c=app.copy,b=app.backups;
 if(b.venueId!==venueId)return html`<wt-button .disabled=${app.installations.pending} @click=${()=>{void b.open(venueId);}}>${c.viewSnapshots}</wt-button>`;
 const selected=b.page?.points.find(p=>p.id===b.selected),continuous=b.page?.continuousRecovery,disabled=app.installations.pending||b.pending||!!b.waiting,recover=app.path==='/recover',showSnapshot=!recover||b.selectedSource==='snapshot';
 const states={pending:c.snapshotPending,verified:c.snapshotVerified,failed:c.snapshotFailed};
 const date=(s:string)=>formatDateTime(s,app.locale);
 return html`<section aria-label=${recover?c.recoverySource:c.snapshotHistory}>${recover?html`<h2>${c.recoverySource}</h2>`:html`<h4>${c.snapshotHistory}</h4>`}
  <p>${c.snapshotPurpose}</p>${recover?nothing:html`<p>${c.recoveryUnavailable}</p>`}
  ${b.error?html`<p role="alert">${c[b.error]}</p>`:nothing}${permissionActions(app,b.error)}
  ${b.pending?html`<p role="status">${c.wait}</p>`:nothing}
  ${b.waiting?html`<p role="status">${c.snapshotRetry}</p>`:nothing}
  ${b.page&&!b.page.points.length?html`<p>${c.noSnapshots}</p>`:nothing}
  ${recover&&continuous?html`<label class="disclosure"><input type="radio" name="recovery-source" .checked=${b.selectedSource==='continuous'} ?disabled=${disabled} @change=${()=>b.selectContinuous()}> ${c.recoveryContinuous}</label>
   <dl><dt>${c.recoveryRecoverable}</dt><dd><time datetime=${continuous.recoverableAt}>${date(continuous.recoverableAt)}</time></dd><dt>${c.recoveryChecked}</dt><dd><time datetime=${continuous.checkedAt}>${date(continuous.checkedAt)}</time></dd></dl>`:nothing}
  ${recover&&b.page?.points.length?html`<label class="disclosure"><input type="radio" name="recovery-source" .checked=${b.selectedSource==='snapshot'} ?disabled=${disabled} @change=${()=>{if(b.selected)b.select(b.selected);}}> ${c.recoverySnapshotFallback}</label>`:nothing}
  ${b.page?.points.length?html`<div class="business-choice"><label for="snapshot-choice">${c.chooseSnapshot}</label><select id="snapshot-choice" ?disabled=${disabled} @change=${(e:Event)=>b.select((e.target as HTMLSelectElement).value)}>${b.page.points.map(p=>html`<option value=${p.id} .selected=${p.id===b.selected}>${date(p.capturedAt)} · ${states[p.verification]} · ${p.id.slice(0,8)}</option>`)}</select></div>`:nothing}
  ${selected&&showSnapshot?html`<dl><dt>${c.snapshotCaptured}</dt><dd><time datetime=${selected.capturedAt}>${date(selected.capturedAt)}</time></dd><dt>${c.snapshotCheck}</dt><dd>${states[selected.verification]}</dd>
    <dt>${c.snapshotRetention}</dt><dd>${selected.retention==='daily'?c.snapshotDaily:c.snapshotMonthly}</dd><dt>${c.snapshotExpiry}</dt><dd><time datetime=${selected.expiresAt}>${date(selected.expiresAt)}</time></dd>
    <dt>${c.snapshotIdentifier}</dt><dd>${selected.id}</dd></dl>
    <p>${selected.verification==='verified'?c.snapshotDataChecked:selected.verification==='failed'?c.snapshotIntegrityFailed:c.snapshotCheckUnavailable}</p>
    ${selected.protection?html`<p>${selected.protection==='recovery'?c.snapshotRecoveryHold:c.snapshotFallback}</p>`:nothing}`:nothing}
  <p class="help">${c.snapshotRetentionHelp}</p>
  <div class="snapshot-actions"><wt-button .disabled=${disabled} @click=${()=>{void b.load();}}>${c.latestSnapshots}</wt-button>
   ${b.page?.nextCursor?html`<wt-button .disabled=${disabled} @click=${()=>{void b.load(true);}}>${c.olderSnapshots}</wt-button>`:nothing}
   <wt-button @click=${()=>{b.close();app.recovery.choose(undefined,undefined);app.draw();}}>${c.closeSnapshots}</wt-button></div>
 </section>`;
}
