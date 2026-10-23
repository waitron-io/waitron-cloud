import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
import {backupScreen} from './backup-screen.ts';
export function recoveryScreen(app:PortalApp){
 const r=app.recovery,c=app.copy,installations=app.installations,b=app.backups;
 if(!r.requestId||app.link.invalid)return html`<p>${c.recoveryMissing}</p>`;
 if(app.session.state.kind!=='authenticated')return html`<p role="status">${c.checking}</p><wt-button .disabled=${!!app.waiting} @click=${()=>{void app.session.check();}}>${c.retry}</wt-button>`;
 const disabled=r.pending||!!app.waiting,op=r.view?.operation,replacement=r.view?.replacement,complete=replacement?.state==='complete',expired=!!r.view&&!complete&&Date.parse(op?.expiresAt??r.view.expiresAt)<=Date.now();
 const venues=[...new Map(installations.visible.filter(i=>i.canRevoke&&i.environment==='test').map(i=>[i.venueId,i])).values()];
 const available=venues.some(i=>i.venueId===b.venueId);
 const selected=b.page?.points.find(p=>p.id===b.selected&&p.verification==='verified'),continuous=b.page?.continuousRecovery,selectionTime=b.selectedSource==='continuous'?continuous?.recoverableAt:selected?.capturedAt,ready=available&&(b.selectedSource==='continuous'?!!continuous:!!selected);
 return html`<p>${c.recoveryIntro}</p><p>${c.recoveryLocal}</p>
  ${r.error?html`<p role="alert">${c[r.error]}</p>`:nothing}
  <wt-input name="recoveryCode" .label=${c.pairCode} .value=${r.code} .required=${true} .disabled=${disabled||!!r.view} autocomplete="off" @wt-change=${(e:CustomEvent<{value:string}>)=>{r.code=e.detail.value;}}></wt-input>
  <wt-button id="submit" .disabled=${disabled} @click=${()=>{app.readFields();void r.inspect();}}>${r.view?c.retry:c.pairInspect}</wt-button>
  ${r.view?html`<p>${c.recoveryExpires} <time datetime=${op?.expiresAt??r.view.expiresAt}>${new Date(op?.expiresAt??r.view.expiresAt).toLocaleString(app.locale)}</time></p>`:nothing}
  ${expired?html`<p role="status">${c.recoveryExpired}</p>`:nothing}
  ${op?html`${!complete?html`<p role="status">${op.status==='closed'?c.recoveryClosed:op.status==='restored'?c.recoveryRestored:op.source.kind==='continuous'?c.recoveryApprovedContinuous:c.recoveryApprovedSnapshot}</p>`:nothing}
    <dl>${op.source.kind==='continuous'?html`<dt>${c.recoveryRecoverable}</dt><dd><time datetime=${op.source.recoverableAt}>${new Date(op.source.recoverableAt).toLocaleString(app.locale)}</time></dd>`:html`<dt>${c.snapshotIdentifier}</dt><dd>${op.source.pointId}</dd>`}<dt>${c.pairVenue}</dt><dd>${op.venueId}</dd></dl>
    ${op.status!=='closed'&&!expired?html`<p>${c.recoveryCancelHelp}</p><wt-button .disabled=${disabled} @click=${()=>{void r.close();}}>${c.recoveryCancel}</wt-button>`:nothing}`:nothing}
  ${op&&!replacement&&op.status==='restored'&&!expired?html`<p role="status">${c.recoveryReplacementWaiting}</p>`:nothing}
  ${replacement?html`<section aria-label=${c.recoveryReplacementTitle}>
    <h2>${c.recoveryReplacementTitle}</h2>
    <p role="status">${complete?c.recoveryReplacementComplete:replacement.state==='awaiting_owner'?c.recoveryReplacementReady:c.recoveryReplacementWaiting}</p>
    <dl style="min-width:0;overflow-wrap:anywhere"><dt>${c.recoveryOrganisation}</dt><dd>${replacement.organisationName}</dd><dt>${c.recoveryBusiness}</dt><dd>${replacement.legalBusinessName}</dd><dt>${c.pairVenue}</dt><dd>${replacement.venueId}</dd><dt>${c.recoveryOldInstallation}</dt><dd>${replacement.oldInstallationId}</dd><dt>${complete?c.recoveryNewInstallation:c.recoveryNewPublicKey}</dt><dd>${complete?replacement.registration?.installationId:replacement.publicKey}</dd></dl>
    ${complete?html`<p>${c.recoveryReplacementCheck}</p><p>${c.recoveryReplacementStopAccess}</p>`:!expired&&op?.status==='restored'&&replacement.state==='awaiting_owner'?html`
      <label class="disclosure"><input type="checkbox" .checked=${r.confirmReplacement} ?disabled=${disabled||r.uncertain} @change=${(e:Event)=>{r.confirmReplacement=(e.target as HTMLInputElement).checked;app.draw();}}> ${c.recoveryReplacementConfirm}</label>
      <wt-button variant="primary" .disabled=${disabled||r.uncertain||!r.confirmReplacement} @click=${()=>{void r.replace();}}>${c.recoveryReplacementApprove}</wt-button>`:nothing}
   </section>`:nothing}
  ${r.view&&!op&&!expired?html`
    ${installations.error?html`<p role="alert">${c[installations.error]}</p>`:nothing}
    <wt-button .disabled=${disabled||installations.pending} @click=${()=>{void installations.load();}}>${c.refreshStatus}</wt-button>
    ${installations.organisations.length>1?html`<label>${c.recoveryOrganisation}<select aria-label=${c.recoveryOrganisation} ?disabled=${disabled||installations.pending} @change=${(e:Event)=>{installations.selectOrganisation((e.target as HTMLSelectElement).value);}}>${installations.organisations.map(o=>html`<option value=${o.id} .selected=${o.id===installations.selectedOrganisation}>${o.name}</option>`)}</select></label>`:nothing}
    <label class="business-choice">${c.recoveryVenue}<select aria-label=${c.recoveryVenue} ?disabled=${disabled} @change=${(e:Event)=>{const value=(e.target as HTMLSelectElement).value;if(value)void b.open(value);else{b.close();r.choose(undefined,undefined);app.draw();}}}><option value="" .selected=${!b.venueId}>${c.recoveryChooseVenue}</option>${venues.map(i=>html`<option value=${i.venueId} .selected=${i.venueId===b.venueId}>${i.overview?.businessName??i.legalBusinessId} · ${i.venueId}</option>`)}</select></label>
    ${available&&b.venueId?backupScreen(app,b.venueId):nothing}
    ${ready&&selectionTime?html`<p><strong>${c.recoveryLoss} ${new Date(selectionTime).toLocaleString(app.locale)}</strong></p>
      <label class="disclosure"><input type="checkbox" .checked=${r.stopped} ?disabled=${disabled||r.uncertain} @change=${(e:Event)=>{r.stopped=(e.target as HTMLInputElement).checked;app.draw();}}> ${c.recoveryStopped}</label>
      <label class="disclosure"><input type="checkbox" .checked=${r.acceptLoss} ?disabled=${disabled||r.uncertain} @change=${(e:Event)=>{r.acceptLoss=(e.target as HTMLInputElement).checked;app.draw();}}> ${c.recoveryAcceptLoss}</label>
      <wt-button variant="primary" .disabled=${disabled||r.uncertain||!r.stopped||!r.acceptLoss} @click=${()=>{void r.approve();}}>${c.recoveryApprove}</wt-button>`:nothing}`:nothing}
  <wt-form-actions><wt-button .disabled=${disabled||app.logoutDisabled} @click=${()=>{void app.logout();}}>${c.signout}</wt-button><a href="/account" @click=${(e:MouseEvent)=>app.follow(e,'/account')}>${c.account}</a></wt-form-actions>`;
}
