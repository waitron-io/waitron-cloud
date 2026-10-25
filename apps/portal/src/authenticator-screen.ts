import {html,nothing} from 'lit';
import {ref} from 'lit/directives/ref.js';
import QRCode from 'qrcode';
import type {PortalApp} from './app.ts';
function clearRequired(app:PortalApp,field:'password'|'proof'|'confirmation',value:string){const f=app.authenticator;
  if(f.requiredField===field&&f.error===(field==='password'?'requiredPassword':'factorCodeRequired')&&(field==='password'?value:value.replace(/\s/g,''))){
    f.error=undefined;f.requiredField=undefined;app.draw();
  }
}
function proof(app:PortalApp){const c=app.copy,f=app.authenticator;
  return html`<label class="factor-proof-type">${c.factorProofType}<select aria-label=${c.factorProofType} .value=${f.proofKind} ?disabled=${f.pending}
    @change=${(e:Event)=>{app.readFields();f.proofKind=(e.target as HTMLSelectElement).value as typeof f.proofKind;f.proofCode='';app.draw();}}>
    <option value="totp">${c.factorTotp}</option><option value="recovery">${c.factorRecovery}</option></select></label>
    <wt-input name="factorProof" .error=${f.requiredField==='proof'&&(f.error==='factorCodeRequired'||f.error==='factorCodeInvalid')?c[f.error]:''} .label=${c.factorProof} .value=${f.proofCode} .autocomplete=${'one-time-code'} .disabled=${f.pending}
      @wt-change=${(e:CustomEvent<{value:string}>)=>{f.proofCode=e.detail.value;clearRequired(app,'proof',f.proofCode);}}></wt-input>`;}
export function authenticatorLoginScreen(app:PortalApp){const c=app.copy,f=app.authenticator;
  return html`<p>${c.factorLoginHelp}</p>${proof(app)}<wt-form-actions>
    <wt-button id="submit" variant="primary" .disabled=${f.pending||Date.now()<f.retryAt} .loading=${f.pending} @click=${()=>{void app.completeFactorLogin();}}>${c.factorVerify}</wt-button>
    <wt-button .disabled=${f.pending} @click=${()=>{app.navigate('/login');}}>${c.factorRestart}</wt-button></wt-form-actions>`;}
export function authenticatorCodesScreen(app:PortalApp){const c=app.copy;
  return html`<p>${c.factorCodesHelp}</p><ul class="factor-codes">${app.factorCodes.map(code=>html`<li><code>${code}</code></li>`)}</ul>
    <wt-button id="submit" variant="primary" @click=${()=>{app.navigate('/login');}}>${c.factorCodesSaved}</wt-button>`;}
export function authenticatorAccountScreen(app:PortalApp){const c=app.copy,f=app.authenticator;
  const password=html`<wt-input name="factorPassword" .error=${f.requiredField==='password'&&f.error==='requiredPassword'?c.requiredPassword:''} .label=${c.factorPassword} .value=${f.password} .type=${'password'} .autocomplete=${'current-password'} .disabled=${f.pending}
    @wt-change=${(e:CustomEvent<{value:string}>)=>{f.password=e.detail.value;clearRequired(app,'password',f.password);}}></wt-input>`;
  const button=(label:string,action:'begin'|'activate'|'regenerate'|'remove'|'cancel')=>html`<wt-button .disabled=${f.pending||Date.now()<f.retryAt} .loading=${f.pending}
    @click=${()=>{void app.manageFactor(action);}}>${label}</wt-button>`;
  return html`<section class="authenticator" aria-labelledby="authenticator-heading"><h3 id="authenticator-heading">${c.factorTitle}</h3>
    <p>${c.factorIntro}</p>${f.error?html`<p role="alert">${c[f.error]}</p>`:nothing}
    ${f.error==='factorCheckSettings'?html`<wt-button .disabled=${f.pending||Date.now()<f.retryAt} @click=${()=>{void app.manageFactor('refresh');}}>${c.factorRefresh}</wt-button>`:nothing}
    ${f.status?html`<p>${f.status.active?c.factorOn:c.factorOff}</p>${f.status.active?html`<p>${c.factorRemaining} ${f.status.recoveryCodesRemaining}</p>`:nothing}`:nothing}
    ${!f.loaded?html`<wt-button .disabled=${f.pending||Date.now()<f.retryAt} @click=${()=>{void f.load();}}>${c.retry}</wt-button>`:nothing}
    ${f.status?.available?html`<p class="help">${c.factorSessions}</p><p class="help">${c.factorRecoveryHelp}</p>
      ${f.enrolment?html`<p>${c.factorScan}</p><canvas role="img" aria-label=${c.factorQR} ${ref((element)=>{
        if(!(element instanceof HTMLCanvasElement)||!f.enrolment)return;const uri=f.enrolment.uri;
        void QRCode.toCanvas(element,uri,{width:240,margin:4}).then(()=>{if(!element.isConnected||f.enrolment?.uri!==uri)element.width=0;}).catch(()=>{element.width=0;});
      })}></canvas><code class="factor-secret">${f.enrolment.secret}</code><p class="help">${c.factorConfirmHelp}</p>`:nothing}
      ${password}${f.status.active?proof(app):nothing}
      ${f.enrolment?html`<wt-input name="factorConfirmation" .error=${f.requiredField==='confirmation'&&(f.error==='factorCodeRequired'||f.error==='factorConfirmationInvalid')?c[f.error]:''} .label=${c.factorConfirmation} .value=${f.confirmation} .autocomplete=${'one-time-code'} .disabled=${f.pending}
        @wt-change=${(e:CustomEvent<{value:string}>)=>{f.confirmation=e.detail.value;clearRequired(app,'confirmation',f.confirmation);}}></wt-input><div class="factor-actions">${button(c.factorActivate,'activate')}${button(c.factorCancel,'cancel')}</div>`
        :html`<div class="factor-actions">${button(f.status.active?c.factorReplace:c.factorEnable,'begin')}${f.status.active?html`${button(c.factorRegenerate,'regenerate')}${button(c.factorRemove,'remove')}`:nothing}</div>`}`
      :f.loaded?html`<p role="status">${c.factorUnavailable}</p>${f.enrolment?button(c.factorCancel,'cancel'):nothing}`:nothing}
    </section>`;
}
