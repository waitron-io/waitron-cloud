import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
import {remoteReady,type RemoteKind} from './remote-types.ts';
export function remoteScreen(app:PortalApp,id:string){
 const c=app.copy,r=app.remote;
 if(r.installationId!==id)return html`<wt-button @click=${()=>{void r.open(id);}}>${c.remoteSetup}</wt-button>`;
 const v=r.view,disabled=r.pending||!!r.waiting,ready=remoteReady(v);
 return html`<section class="remote-setup" aria-label=${c.remoteSetupTitle}><h4>${c.remoteSetupTitle}</h4>
  ${r.error?html`<p role="alert">${c[r.error]}</p>`:nothing}${r.notice?html`<p role="status">${c[r.notice]}</p>`:nothing}
  ${r.pending?html`<p role="status">${c.wait}</p>`:nothing}
  ${v?html`<p role="status">${v.revoked?c.accessStopped:ready?c.remoteReady:v.names?c.remotePending:c.remoteNotPlaced}</p>`:nothing}
  ${v?.names?html`<p>${c.remotePrivacy}</p>
   ${(['staff','public'] as const).map(kind=>html`<h5>${kind==='staff'?c.remoteStaff:c.remotePublic}</h5><dl><dt>${c.remoteCurrent}</dt><dd>${ready?html`<a href=${'https://'+v.names![kind].current} target="_blank" rel="noopener noreferrer">${v.names![kind].current}</a>`:v.names![kind].current}</dd><dt>${c.remoteAssigned}</dt><dd>${v.names![kind].assigned}</dd></dl>`)}
   <details><summary>${c.remoteLan}</summary><p>${c.remoteLanHelp}</p><p>${c.remoteLanTest}</p></details>
   ${!v.revoked?html`<h5>${c.remoteCustom}</h5><div class="business-choice"><label for="remote-kind">${c.remoteWhich}</label><select id="remote-kind" .value=${r.kind} ?disabled=${disabled} @change=${(e:Event)=>r.choose((e.target as HTMLSelectElement).value as RemoteKind)}><option value="staff">${c.remoteStaff}</option><option value="public">${c.remotePublic}</option></select></div>
    <wt-input name="remoteHostname" .label=${c.remoteHostname} .value=${r.hostname} .disabled=${disabled} @wt-change=${(e:CustomEvent<{value:string}>)=>r.edit(e.detail.value)}></wt-input>
    <div class="snapshot-actions"><wt-button .disabled=${disabled} @click=${()=>{void r.preview();}}>${c.remoteReview}</wt-button><wt-button .disabled=${disabled} @click=${()=>r.edit(v.names![r.kind].assigned)}>${c.remoteUseAssigned}</wt-button></div>
    ${r.confirmation?html`<div role="group" aria-label=${c.remoteConfirmTitle}><h5>${c.remoteConfirmTitle}</h5><p>${c.remoteInterruption}</p><p><strong>${r.confirmation.hostname}</strong></p>
     ${r.confirmation.records.length?html`<p>${c.remoteDnsHelp}</p>${r.confirmation.records.map(record=>html`<dl><dt>${c.remoteRecord}</dt><dd>CNAME</dd><dt>${c.remoteRecordName}</dt><dd>${record.name}</dd><dt>${c.remoteRecordValue}</dt><dd>${record.value}</dd></dl>`)}<p class="help">${c.remoteDnsApex}</p>`:html`<p>${c.remoteAssignedHelp}</p>`}
     <wt-button .disabled=${disabled} @click=${()=>{void r.apply();}}>${c.remoteConfirm}</wt-button></div>`:nothing}`:nothing}`:nothing}
  <p class="help">${c.remoteLocalTrial}</p>
  <div class="snapshot-actions"><wt-button .disabled=${disabled} @click=${()=>{void r.load();}}>${c.refreshStatus}</wt-button><wt-button @click=${()=>{r.close();app.draw();}}>${c.remoteClose}</wt-button></div>
 </section>`;
}
