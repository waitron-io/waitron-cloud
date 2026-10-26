import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
import type {Copy} from './locale.ts';

export function permissionActions(app:PortalApp,error:keyof Copy|undefined){
 if(error!=='permissionAccount'&&error!=='permissionBusiness')return nothing;
 return html`<nav class="permission-actions"><a href="/account">${app.copy.permissionBack}</a>
  <wt-button .disabled=${app.logoutDisabled||app.diagnostics.pending} @click=${()=>{void app.logout();}}>${app.copy.signout}</wt-button></nav>`;
}
