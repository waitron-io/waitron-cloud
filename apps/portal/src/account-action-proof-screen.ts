import {html,nothing} from 'lit';
import {submitOnEnter} from '@waitron-io/ui-core/submit-on-enter';
import type {PortalApp} from './app.ts';
export function accountActionProofScreen(app:PortalApp,headingLevel:2|3=3){
 const p=app.actionProof,c=app.copy,disabled=p.pending||!!p.waiting||app.passkeys.pending;
 const verify=(method:'email'|'app'|'recovery',label:string,id?:string)=>html`<wt-button id=${id??nothing} .disabled=${disabled||!p.code} @click=${()=>{void p.verify(method);}}>${label}</wt-button>`;
 return html`<section class="action-proof" aria-labelledby="action-proof-heading">${headingLevel===2?html`<h2 id="action-proof-heading" tabindex="-1">${c.actionProofTitle}</h2>`:html`<h3 id="action-proof-heading" tabindex="-1">${c.actionProofTitle}</h3>`}
  <p>${p.status?.freshUntil?c.actionProofReady:c.actionProofHelp}</p>${p.error?html`<p role="alert">${c[p.error]}</p>`:nothing}
  ${p.status?.freshUntil?nothing:html`
   ${p.status?.methods.includes('passkey')?html`<wt-button .disabled=${disabled} @click=${()=>{void app.proveWithPasskey();}}>${c.actionProofPasskey}</wt-button>`:nothing}
   ${p.status?.methods.includes('email')&&!p.challengeToken?html`<wt-button .disabled=${disabled} @click=${()=>{void p.email(app.locale);}}>${c.actionProofEmail}</wt-button>`:nothing}
   ${p.challengeToken||p.status?.methods.some(m=>m==='app'||m==='recovery')?html`<wt-input name="actionProofCode" .label=${c.factorProof} .value=${p.code} .error=${p.error==='factorCodeInvalid'?c.factorCodeInvalid:''} .autocomplete=${'one-time-code'} .disabled=${disabled}
    @wt-change=${(e:CustomEvent<{value:string}>)=>{p.code=e.detail.value;if(p.error==='factorCodeInvalid')p.error=undefined;app.draw();}} @keydown=${(e:KeyboardEvent)=>submitOnEnter(e,app.root.querySelector('#action-proof-verify'))}></wt-input>
    <wt-form-actions>${p.challengeToken?verify('email',c.factorVerify,'action-proof-verify'):html`${p.status?.methods.includes('app')?verify('app',c.factorTotp,'action-proof-verify'):nothing}${verify('recovery',c.factorRecovery,p.status?.methods.includes('app')?undefined:'action-proof-verify')}`}</wt-form-actions>`:nothing}
   ${!p.status?html`<wt-button .disabled=${disabled} @click=${()=>{void p.load();}}>${c.retry}</wt-button>`:nothing}`}
 </section>`;
}
