import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
export function backupScreen(app:PortalApp,venueId:string){
 const c=app.copy,b=app.backups;
 if(b.venueId!==venueId)return html`<wt-button @click=${()=>{void b.open(venueId);}}>${c.viewSnapshots}</wt-button>`;
 const selected=b.page?.points.find(p=>p.id===b.selected),disabled=b.pending||!!b.waiting;
 const states={pending:c.snapshotPending,verified:c.snapshotVerified,failed:c.snapshotFailed};
 const date=(s:string)=>new Date(s).toLocaleString(app.locale);
 return html`<section aria-label=${c.snapshotHistory}><h4>${c.snapshotHistory}</h4>
  <p>${c.snapshotPurpose}</p><p>${c.recoveryUnavailable}</p>
  ${b.error?html`<p role="alert">${c[b.error]}</p>`:nothing}
  ${b.pending?html`<p role="status">${c.wait}</p>`:nothing}
  ${b.waiting?html`<p role="status">${c.snapshotRetry}</p>`:nothing}
  ${b.page&&!b.page.points.length?html`<p>${c.noSnapshots}</p>`:nothing}
  ${b.page?.points.length?html`<div class="business-choice"><label for="snapshot-choice">${c.chooseSnapshot}</label><select id="snapshot-choice" .value=${b.selected??''} ?disabled=${disabled} @change=${(e:Event)=>b.select((e.target as HTMLSelectElement).value)}>${b.page.points.map(p=>html`<option value=${p.id}>${date(p.capturedAt)} · ${states[p.verification]} · ${p.id.slice(0,8)}</option>`)}</select></div>`:nothing}
  ${selected?html`<dl><dt>${c.snapshotCaptured}</dt><dd><time datetime=${selected.capturedAt}>${date(selected.capturedAt)}</time></dd><dt>${c.snapshotCheck}</dt><dd>${states[selected.verification]}</dd>
    <dt>${c.snapshotRetention}</dt><dd>${selected.retention==='daily'?c.snapshotDaily:c.snapshotMonthly}</dd><dt>${c.snapshotExpiry}</dt><dd><time datetime=${selected.expiresAt}>${date(selected.expiresAt)}</time></dd>
    <dt>${c.snapshotIdentifier}</dt><dd>${selected.id}</dd></dl>
    ${selected.protection?html`<p>${selected.protection==='recovery'?c.snapshotRecoveryHold:c.snapshotFallback}</p>`:nothing}`:nothing}
  <p class="help">${c.snapshotRetentionHelp}</p>
  <div class="snapshot-actions"><wt-button .disabled=${disabled} @click=${()=>{void b.load();}}>${c.latestSnapshots}</wt-button>
   ${b.page?.nextCursor?html`<wt-button .disabled=${disabled} @click=${()=>{void b.load(true);}}>${c.olderSnapshots}</wt-button>`:nothing}
   <wt-button @click=${()=>{b.close();app.draw();}}>${c.closeSnapshots}</wt-button></div>
 </section>`;
}
