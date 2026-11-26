import {accountActionProofScreen} from './account-action-proof-screen.ts';
import {formatDateTime} from './dates.ts';
import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
import {permissionActions} from './permission-actions.ts';
export function recoveryScreen(app:PortalApp){
 const r=app.recovery,c=app.copy,installations=app.installations,b=app.backups;
 if(!r.requestId||app.link.invalid)return html`<p>${c.recoveryMissing}</p>`;
 if(app.session.state.kind!=='authenticated')return html`<p role="status">${app.session.state.kind==='unavailable'?c.sessionUnavailable:c.checking}</p>${app.session.state.kind==='unavailable'?html`<wt-button .disabled=${!!app.waiting} @click=${()=>{void app.session.check();}}>${c.retry}</wt-button>`:nothing}`;
 const disabled=r.pending||!!app.waiting,op=r.view?.operation,replacement=r.view?.replacement,complete=replacement?.state==='complete',expired=!!r.view&&!complete&&Date.parse(op?.expiresAt??r.view.expiresAt)<=Date.now();
 const venues=[...new Map(installations.visible.filter(i=>i.canRevoke&&i.environment==='test').map(i=>[i.venueId,i])).values()];
 const selectionDisabled=disabled||installations.pending;
 const available=venues.some(i=>i.venueId===b.venueId);
 const continuous=b.page?.continuousRecovery,usingContinuous=r.source==='continuous';
 const snapshotAvailable=b.hasCheckedSnapshot;
 const sourceDisabled=selectionDisabled||b.pending;
 const ready=available&&b.page?.venueId===r.venueId&&(usingContinuous?!!continuous:r.source==='snapshot'&&snapshotAvailable);
 const selectingSnapshot=op?op.source.kind==='snapshot'&&op.pointId===null:!usingContinuous;
 const proofRequested=app.actionProof.loaded||app.actionProof.pending||['pairEnrollment','actionProofUnavailable','recoveryProofRequired'].includes(r.error??'');
 const errorMessage=r.error==='recoveryActive'&&r.recoveryExpiresAt
  ?c.recoveryActiveUntil.replace('{deadline}',formatDateTime(r.recoveryExpiresAt,app.locale))
  :r.error?c[r.error]:nothing;
 const approvalDisabled=op?disabled:sourceDisabled,approval=html`
      <label class="disclosure"><input type="checkbox" .checked=${r.stopped} ?disabled=${approvalDisabled||r.uncertain} @change=${(e:Event)=>{r.stopped=(e.target as HTMLInputElement).checked;app.draw();}}> ${c.recoveryStopped}</label>
      <label class="disclosure"><input type="checkbox" .checked=${r.acceptLoss} ?disabled=${approvalDisabled||r.uncertain} @change=${(e:Event)=>{r.acceptLoss=(e.target as HTMLInputElement).checked;app.draw();}}> ${selectingSnapshot?c.recoveryAcceptSnapshotLoss:op?c.recoveryAcceptExistingLoss:c.recoveryAcceptLoss}</label>
      <wt-button variant="primary" .disabled=${approvalDisabled||r.uncertain||!r.stopped||!r.acceptLoss} @click=${()=>{void app.approveRecovery();}}>${c.recoveryApprove}</wt-button>`;
 return html`<p>${c.recoveryIntro}</p><p>${c.recoveryLocal}</p>
  ${r.error?html`<p role=${r.error==='recoveryProofRequired'||r.error==='pairEnrollment'?'status':'alert'}>${errorMessage}</p>`:nothing}
  <wt-input name="recoveryCode" .label=${c.pairCode} .value=${r.code} .error=${r.error==='pairCodeError'?c.pairCodeError:''} .required=${true} .disabled=${disabled||!!r.view} autocomplete="off" @wt-change=${(e:CustomEvent<{value:string}>)=>{r.code=e.detail.value;if(r.error==='pairCodeError')r.error=undefined;app.draw();}}></wt-input>
  <wt-button id="submit" .disabled=${disabled} @click=${()=>{app.readFields();void r.inspect();}}>${r.view?(r.error?c.recoveryCheckRequest:c.retry):c.pairInspect}</wt-button>
  ${r.view?html`<p>${c.recoveryExpires} <time datetime=${op?.expiresAt??r.view.expiresAt}>${formatDateTime(op?.expiresAt??r.view.expiresAt,app.locale)}</time></p>`:nothing}
  ${expired?html`<p role="status">${c.recoveryExpired}</p>`:nothing}
  ${r.view&&(!op||op.status==='pending')&&!expired&&proofRequested?html`${r.error==='pairEnrollment'||app.actionProof.status?.methods.every(m=>m==='email')?html`<a href="/account" @click=${(event:MouseEvent)=>app.follow(event,'/account')}>${c.accountSecurity}</a>`:accountActionProofScreen(app,2)}`:nothing}
  ${op?html`${!complete?html`<p role="status">${op.status==='closed'?c.recoveryClosed:op.status==='restored'?c.recoveryRestored:op.source.kind==='continuous'?c.recoveryApprovedContinuous:c.recoveryApprovedSnapshot}</p>`:nothing}
    <dl>${op.source.kind==='continuous'?html`<dt>${c.recoveryRecoverable}</dt><dd><time datetime=${op.source.recoverableAt}>${formatDateTime(op.source.recoverableAt,app.locale)}</time></dd>`:op.pointId?html`<dt>${c.snapshotIdentifier}</dt><dd>${op.pointId}</dd>`:nothing}<dt>${c.pairVenue}</dt><dd>${op.venueId}</dd></dl>
    ${op.status==='pending'&&!expired&&selectingSnapshot?html`<p>${c.recoverySnapshotLoss}</p>`:nothing}
    ${op.status==='pending'&&!expired?html`<p>${c.recoveryReauthoriseHelp}</p>${approval}`:nothing}
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
    <wt-button .disabled=${selectionDisabled} @click=${()=>{void installations.load();void b.load();}}>${c.refreshStatus}</wt-button>
    ${installations.organisations.length>1?html`<label class="business-choice">${c.recoveryOrganisation}<select aria-label=${c.recoveryOrganisation} ?disabled=${selectionDisabled} @change=${(e:Event)=>{installations.selectOrganisation((e.target as HTMLSelectElement).value);}}>${installations.organisations.map(o=>html`<option value=${o.id} .selected=${o.id===installations.selectedOrganisation}>${o.name}</option>`)}</select></label>`:nothing}
    <label class="business-choice">${c.recoveryVenue}<select aria-label=${c.recoveryVenue} ?disabled=${selectionDisabled} @change=${(e:Event)=>{const value=(e.target as HTMLSelectElement).value;if(value)void b.open(value);else{b.close();r.choose(undefined);app.draw();}}}><option value="" .selected=${!b.venueId}>${c.recoveryChooseVenue}</option>${venues.map(i=>html`<option value=${i.venueId} .selected=${i.venueId===b.venueId}>${i.overview?.businessName??i.legalBusinessId} · ${i.venueId}</option>`)}</select></label>
    ${available?html`<section aria-label=${c.recoverySource}><h2>${c.recoverySource}</h2>
      ${b.error?html`<p role="alert">${c[b.error]}</p>`:nothing}${permissionActions(app,b.error)}
      ${b.pending?html`<p role="status">${c.wait}</p>`:nothing}
      ${b.waiting?html`<p role="status">${c.recoverySourceRetry}</p>`:nothing}
      ${b.error?html`<wt-button .disabled=${sourceDisabled} @click=${()=>{void b.load();}}>${c.retry}</wt-button>`:nothing}
      ${b.page&&!snapshotAvailable?html`<p>${b.page.points.length?c.recoveryNoCheckedSnapshots:c.noSnapshots}</p>`:nothing}
      ${ready?html`
        ${continuous?html`<label class="disclosure"><input type="radio" name="recovery-source" .checked=${usingContinuous} ?disabled=${sourceDisabled} @change=${()=>b.selectContinuous()}> ${c.recoveryContinuous}</label>
          <dl><dt>${c.recoveryRecoverable}</dt><dd><time datetime=${continuous.recoverableAt}>${formatDateTime(continuous.recoverableAt,app.locale)}</time></dd><dt>${c.recoveryChecked}</dt><dd><time datetime=${continuous.checkedAt}>${formatDateTime(continuous.checkedAt,app.locale)}</time></dd></dl>`:nothing}
        ${snapshotAvailable?html`<label class="disclosure"><input type="radio" name="recovery-source" .checked=${!usingContinuous} ?disabled=${sourceDisabled} @change=${()=>b.selectSnapshot()}> ${c.recoverySnapshotFallback}</label>`:nothing}
        <p><strong>${usingContinuous&&continuous?`${c.recoveryLoss} ${formatDateTime(continuous.recoverableAt,app.locale)}`:c.recoverySnapshotLoss}</strong></p>
        ${approval}`:nothing}
      </section>`:nothing}`:nothing}
  <wt-form-actions><wt-button .disabled=${disabled||app.logoutDisabled} @click=${()=>{void app.logout();}}>${c.signout}</wt-button><a href="/account" @click=${(e:MouseEvent)=>app.follow(e,'/account')}>${c.account}</a></wt-form-actions>`;
}
