import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
import type {Copy} from './locale.ts';
import {accountActionProofScreen} from './account-action-proof-screen.ts';

export function cloudActionsScreen(app:PortalApp){
 const c=app.copy,actions=app.cloudActions,disabled=actions.pending||!!actions.waiting;
 const date=(value:string)=>new Intl.DateTimeFormat(app.locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
 const state=(value:string)=>c[`cloudActionState_${value}` as keyof Copy];
 return html`<div class="cloud-actions"><p>${c.cloudActionsHelp}</p>
  ${actions.error?html`<p role="alert">${c[actions.error]}</p>`:nothing}
  ${actions.pending?html`<p role="status">${c.checking}</p>`:nothing}
  ${actions.view?html`
   <section aria-labelledby="cloud-requests-heading"><h2 id="cloud-requests-heading">${c.cloudActionsRequests}</h2><p>${c.cloudActionsRecent}</p>
    ${actions.view.requests.length===0?html`<p>${c.cloudActionsEmpty}</p>`:actions.view.requests.map(request=>html`<article class="installation" aria-labelledby=${'request-'+request.id}>
     <h3 id=${'request-'+request.id}>${c[`cloudAction_${request.actionId}` as keyof Copy]}</h3>
     <p>${state(request.state)}</p><dl>
      <dt>${c.cloudActionsOccurrence}</dt><dd>${request.occurrence} (${request.version})</dd>
      <dt>${c.cloudActionsCell}</dt><dd>${request.cell}</dd><dt>${c.cloudActionsTarget}</dt><dd>${request.target}</dd>
      <dt>${c.cloudActionsProposal}</dt><dd>${request.proposal}</dd><dt>${c.cloudActionsEvidence}</dt><dd>${request.evidence}</dd>
     </dl><p>${c.cloudActionsUnavailable}</p>
     ${request.approvalExpiresAt?html`<p>${c.cloudActionsExpires}: ${date(request.approvalExpiresAt)}</p>`:nothing}
     ${request.events.map(event=>html`<p>${state(event.kind)} · ${date(event.at)}</p>`)}
     ${request.state==='pending'?html`<wt-form-actions><wt-button .disabled=${disabled} @click=${()=>{void app.decideCloudAction(request,'approved');}}>${c.cloudActionsApprove}</wt-button>
      <wt-button .disabled=${disabled} @click=${()=>{void app.decideCloudAction(request,'rejected');}}>${c.cloudActionsReject}</wt-button></wt-form-actions>`:nothing}
    </article>`)}
   </section>
   <section id="cloud-proposal" class="business-choice" aria-labelledby="cloud-proposal-heading">
    <h2 id="cloud-proposal-heading">${c.cloudActionsNew}</h2><p>${c.cloudActionsNoExecution}</p>
    <label for="cloud-action-choice">${c.cloudActionsAction}</label><select id="cloud-action-choice" name="actionId" ?disabled=${disabled}
     @change=${(event:Event)=>{actions.draft.actionId=(event.target as HTMLSelectElement).value;}}>
     ${actions.view.actions.map(action=>html`<option value=${action.id} .selected=${action.id===actions.draft.actionId}>${c[`cloudAction_${action.id}` as keyof Copy]}</option>`)}
    </select>
    ${(['occurrence','cell','target','proposal','evidence'] as const).map(key=>html`<wt-input name=${key} .label=${c[('cloudActions'+key[0]!.toUpperCase()+key.slice(1)) as keyof Copy]}
     .value=${actions.draft[key]} .required=${true} .disabled=${disabled}
     @wt-change=${(event:CustomEvent<{value:string}>)=>{actions.draft[key]=event.detail.value;}}></wt-input>`)}
    <wt-form-actions><wt-button id="submit" .disabled=${disabled} @click=${()=>{void app.proposeCloudAction();}}>${c.cloudActionsSave}</wt-button></wt-form-actions>
   </section>
   ${app.actionProof.loaded||app.actionProof.pending?accountActionProofScreen(app,2):nothing}
   <h2>${c.cloudActionsPolicies}</h2><ul>${actions.view.actions.map(action=>html`<li>
    <h3>${c[`cloudAction_${action.id}` as keyof Copy]}</h3><p>${action.policy==='ask-first'?c.cloudActionsAsk:c.cloudActionsReport}</p><p>${c.cloudActionsUnavailable}</p>
   </li>`)}</ul>`:nothing}
  <wt-form-actions><wt-button .disabled=${disabled} @click=${()=>{void actions.load();}}>${c.refreshStatus}</wt-button></wt-form-actions>
  <nav><a href="/account" @click=${(event:MouseEvent)=>app.follow(event,'/account')}>${c.permissionBack}</a></nav></div>`;
}
