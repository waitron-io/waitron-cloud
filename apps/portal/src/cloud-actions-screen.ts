import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
import type {Copy} from './locale.ts';

export function cloudActionsScreen(app:PortalApp){
 const c=app.copy,actions=app.cloudActions;
 return html`<p>${c.cloudActionsHelp}</p>
  ${actions.error?html`<p role="alert">${c[actions.error]}</p>`:nothing}
  ${actions.pending?html`<p role="status">${c.checking}</p>`:nothing}
  ${actions.view?html`<ul>${actions.view.actions.map(action=>html`<li>
   <h2>${c[`cloudAction_${action.id}` as keyof Copy]}</h2>
   <p>${action.policy==='ask-first'?c.cloudActionsAsk:c.cloudActionsReport}</p>
   <p>${c.cloudActionsUnavailable}</p>
  </li>`)}</ul>`:nothing}
  <wt-form-actions><wt-button .disabled=${actions.pending||!!actions.waiting} @click=${()=>{void actions.load();}}>${c.refreshStatus}</wt-button></wt-form-actions>
  <nav><a href="/account" @click=${(event:MouseEvent)=>app.follow(event,'/account')}>${c.permissionBack}</a></nav>`;
}
