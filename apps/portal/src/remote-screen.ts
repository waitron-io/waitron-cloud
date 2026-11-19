import {permissionActions} from './permission-actions.ts';
import {html,nothing,type LitElement} from 'lit';
import {submitOnEnter} from '@waitron-io/ui-core/submit-on-enter';
import type {AccountInstallation} from './installation-types.ts';
import type {PortalApp} from './app.ts';
import {remoteReady,type RemoteKind,type ForwardCause} from './remote-types.ts';
const forwardCopy:Record<ForwardCause,'forwardNon200'|'forwardTimeout'|'forwardLimit'|'forwardTransport'|'forwardInternal'>={upstream_non_200:'forwardNon200',upstream_timeout:'forwardTimeout',upstream_response_limit:'forwardLimit',upstream_transport:'forwardTransport',forward_internal:'forwardInternal'};
export function remoteScreen(app:PortalApp,installation:AccountInstallation){
 const {installationId:id,venueId,revokedAt}=installation;
 const c=app.copy,r=app.remote,triggerId='remote-details-'+id;
 const v=r.installationId===id?r.view:undefined;
 const canStart=!revokedAt&&!v?.revoked&&app.billing.venues.some(venue=>
   venue.venueId===venueId&&venue.level==='registered'&&venue.canStartTrial);
 const trial=canStart?html`<p><a href="/account/billing" @click=${async(event:MouseEvent)=>{
   app.follow(event,'/account/billing');
   if(!event.defaultPrevented)return;
   app.billing.select(venueId);
   const start=app.root.querySelector<LitElement>('#connected-trial-start');
   await start?.updateComplete;
   start?.shadowRoot?.querySelector('button')?.focus();
 }}>${c.billingStart}</a></p>`:nothing;
 if(r.installationId!==id)return html`${trial}<wt-button id=${triggerId} .disabled=${app.installations.pending} @click=${()=>{void r.open(id);}}>${revokedAt?c.guestMenuTitle:c.remoteSetup}</wt-button>`;
 const disabled=app.installations.pending||r.pending||!!r.waiting,ready=remoteReady(v);
 const menu=v?.guestMenu,menuStatusId='guest-menu-status-'+id;
 return html`${trial}<section class="remote-setup" aria-label=${c.remoteSetupTitle}><h4>${c.remoteSetupTitle}</h4>
  ${r.error?html`<p role=${r.error==='remoteProofRequired'?'status':'alert'}>${c[r.error]}</p>`:nothing}${permissionActions(app,r.error)}${r.notice?html`<p role="status">${c[r.notice]}</p>`:nothing}
  ${r.error==='pairEnrollment'?html`<a href="/account" @click=${(event: MouseEvent) => app.openAccountSecurity(event)}>${c.accountSecurity}</a>`:r.error==='actionProofUnavailable'||r.error==='remoteProofRequired'?html`<a href="#action-proof-heading" @click=${(event:MouseEvent)=>{event.preventDefault();app.root.querySelector<HTMLElement>('#action-proof-heading')?.focus();}}>${c.actionProofTitle}</a>`:nothing}
  ${r.error&&['remotePlanRequired','remoteSetupRequired','remoteTestOnly','remoteRevoked'].includes(r.error)?html`<a href="/account" @click=${(event:MouseEvent)=>app.follow(event,'/account')}>${c.permissionBack}</a>`:nothing}
  ${r.error==='remoteRevoked'?html`<wt-button .disabled=${disabled||!!app.installations.waiting} @click=${()=>{void app.installations.load();}}>${c.remoteRefreshInstallations}</wt-button>`:nothing}
  ${r.pending?html`<p role="status">${c.wait}</p>`:nothing}
  ${v?html`<p role="status">${v.revoked?c.remoteRevoked:v.connectedRequired?c.remoteConnectedRequired:ready?c.remoteReady:v.names?c.remotePending:c.remoteNotPlaced}</p>`:nothing}
  ${menu?html`<section aria-label=${c.guestMenuTitle}><h5>${c.guestMenuTitle}</h5>
   <p role="status" tabindex="-1" id=${menuStatusId}>${menu.state==='current'?c.guestMenuCurrent:menu.state==='blocked'?c.guestMenuBlocked:c.guestMenuOff}</p>
   <p><a href=${menu.url} target="_blank" rel="noopener noreferrer">${c.guestMenuLink}</a></p>
   ${menu.publication?html`<p><time datetime=${menu.publication.receivedAt}>${new Date(menu.publication.receivedAt).toLocaleString(app.locale)}</time></p>`:nothing}
   ${menu.state==='off'?nothing:html`<wt-button .disabled=${disabled} @click=${async()=>{
     const block=menu.state==='current';
     await r.setGuestMenuBlocked(block);
     if(!block&&r.installationId===id&&r.view?.guestMenu?.state==='off')app.root.querySelector<HTMLElement>('#'+menuStatusId)?.focus();
   }}>${menu.state==='blocked'?c.guestMenuEnable:c.guestMenuTakedown}</wt-button>`}
   ${menu.state==='blocked'?html`<p class="help">${c.guestMenuHelp}</p>`:nothing}
  </section>`:nothing}
  ${v?html`<section aria-label=${c.forwardTitle}><h5>${c.forwardTitle}</h5>
   <p>${!v.publicForward?c.forwardUnknown:v.publicForward.category===null?c.forwardSuccess:c[forwardCopy[v.publicForward.category]]}</p>
   ${v.publicForward?html`<dl><dt>${c.forwardObserved}</dt><dd><time datetime=${v.publicForward.observedAt}>${new Date(v.publicForward.observedAt).toLocaleString(app.locale)}</time></dd><dt>${c.forwardExpires}</dt><dd><time datetime=${v.publicForward.expiresAt}>${new Date(v.publicForward.expiresAt).toLocaleString(app.locale)}</time></dd></dl>${v.publicForward.category!==null?html`<p>${c.forwardCheck}</p>`:nothing}`:nothing}
  </section>`:nothing}
  ${v?.names&&!v.connectedRequired?html`<p>${c.remotePrivacy}</p>
   ${(['staff','public'] as const).map(kind=>{
    const name=v.names![kind],heading='remote-name-'+kind;
    const notice=c.remoteRecordMoved.replace('{hostname}',name.current).replace('{target}',name.assigned);
    return html`<h5 id=${heading} tabindex="-1">${kind==='staff'?c.remoteStaff:c.remotePublic}</h5>
     <dl><dt>${c.remoteCurrent}</dt><dd>${ready?html`<a href=${'https://'+name.current} target="_blank" rel="noopener noreferrer">${name.current}</a>`:name.current}</dd><dt>${c.remoteAssigned}</dt><dd>${name.assigned}</dd></dl>
     ${name.recordMoved&&!v.revoked?html`<p role="status">${notice}</p>
      <wt-button .disabled=${disabled} @click=${async()=>{if(await r.recheck(kind))app.root.querySelector<HTMLElement>('#'+heading)?.focus();}}>${c.remoteCheckAgain}</wt-button>`:nothing}`;
   })}
   <details><summary>${c.remoteLan}</summary><p>${c.remoteLanHelp}</p><p>${c.remoteLanTest}</p></details>
   ${!v.revoked?html`<h5>${c.remoteCustom}</h5><div class="business-choice"><label for="remote-kind">${c.remoteWhich}</label><select id="remote-kind" .value=${r.kind} ?disabled=${disabled} @change=${(e:Event)=>r.choose((e.target as HTMLSelectElement).value as RemoteKind)}><option value="staff">${c.remoteStaff}</option><option value="public">${c.remotePublic}</option></select></div>
    <wt-input name="remoteHostname" .label=${c.remoteHostname} .required=${true} .error=${r.error==='remoteInvalid'?c.remoteInvalid:''} .value=${r.hostname} .disabled=${disabled} @wt-change=${(e:CustomEvent<{value:string}>)=>r.edit(e.detail.value)}
      @keydown=${(event:KeyboardEvent)=>submitOnEnter(event,app.root.querySelector('#remote-review'))}></wt-input>
    <div class="snapshot-actions"><wt-button id="remote-review" .disabled=${disabled||!r.hostnameChanged} @click=${()=>{void r.preview();}}>${c.remoteReview}</wt-button><wt-button .disabled=${disabled} @click=${()=>r.edit(v.names![r.kind].assigned)}>${c.remoteUseAssigned}</wt-button></div>
    ${r.confirmation?html`<div role="group" aria-label=${c.remoteConfirmTitle}><h5>${c.remoteConfirmTitle}</h5><p>${c.remoteInterruption}</p><p><strong>${r.confirmation.hostname}</strong></p>
     ${r.confirmation.records.length?html`<p>${c.remoteDnsHelp}</p>${r.confirmation.records.map(record=>html`<dl><dt>${c.remoteRecord}</dt><dd>CNAME</dd><dt>${c.remoteRecordName}</dt><dd>${record.name}</dd><dt>${c.remoteRecordValue}</dt><dd>${record.value}</dd></dl>`)}<p class="help">${c.remoteDnsApex}</p>`:html`<p>${c.remoteAssignedHelp}</p>`}
     <wt-button .disabled=${disabled||app.actionProof.pending} @click=${()=>{void app.applyRemote();}}>${c.remoteConfirm}</wt-button></div>`:nothing}`:nothing}`:nothing}
  ${v&&!v.revoked&&!v.connectedRequired?html`<p class="help">${c.remoteBoxSwitch}</p>`:nothing}
  <div class="snapshot-actions"><wt-button .disabled=${disabled} @click=${()=>{void r.load();}}>${c.refreshStatus}</wt-button><wt-button @click=${async()=>{
    r.close();
    app.draw();
    const trigger=app.root.querySelector<LitElement>('#'+triggerId);
    await trigger?.updateComplete;
    trigger?.shadowRoot?.querySelector('button')?.focus();
  }}>${c.remoteClose}</wt-button></div>
 </section>`;
}
