import {accountRequest,type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
export type ActionProofStatus={methods:('email'|'app'|'passkey'|'recovery')[];freshUntil:string|null};
type Request=<T>(path:string,body?:Record<string,unknown>)=>Promise<ApiResult<T>>;
export class AccountActionProofController{
  status:ActionProofStatus|undefined;challengeToken:string|undefined;code='';pending=false;loaded=false;error:keyof Copy|undefined;
  #account:string|undefined;#generation=0;#changed:()=>void;#request:Request;#retryUntil=0;
  constructor(changed:()=>void,request:Request=accountRequest){this.#changed=changed;this.#request=request;}
  get waiting(){return Math.max(0,Math.ceil((this.#retryUntil-performance.now())/1000));}
  fence(){this.#generation++;this.status=undefined;this.challengeToken=undefined;this.code='';this.pending=false;this.loaded=false;this.error=undefined;}
  account(account:string|undefined){if(account===this.#account)return;this.#account=account;this.fence();}
  #failure(r:Extract<ApiResult<unknown>,{ok:false}>){this.#retryUntil=Math.max(this.#retryUntil,performance.now()+r.retryAfterMs);this.error=r.status===429?'limited':'actionProofUnavailable';}
  async load(){
    if(!this.#account||this.pending||this.waiting)return;
    const generation=this.#generation;this.pending=true;this.error=undefined;this.#changed();
    const result=await this.#request<ActionProofStatus>('/action-proof');
    if(generation!==this.#generation)return;this.pending=false;this.loaded=true;
    if(result.ok)this.status=result.value;else{this.status=undefined;this.#failure(result);}this.#changed();
  }
  async ensure(){const generation=this.#generation;await this.load();return generation===this.#generation&&!!this.status?.freshUntil&&!this.pending&&!this.waiting;}
  async email(locale?:'en'|'es'){
    if(!this.#account||this.pending||this.waiting)return;
    const generation=this.#generation;this.pending=true;this.error=undefined;this.code='';this.#changed();
    const result=await this.#request<{challengeToken:string}>('/action-proof/email',locale?{locale}:{});
    if(generation!==this.#generation)return;this.pending=false;
    if(result.ok)this.challengeToken=result.value.challengeToken;else this.#failure(result);this.#changed();
  }
  async verify(method:'email'|'app'|'recovery'){
    if(!this.#account||this.pending||this.waiting||!this.code)return;
    const normalised=this.code.replace(/\s/g,'');
    if(!(method==='recovery'?/^(?:[A-Fa-f0-9]{32}|[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{8}){3})$/:/^\d{6}$/).test(normalised)){this.error='factorCodeInvalid';this.#changed();return;}
    const generation=this.#generation,code=normalised;this.code='';this.pending=true;this.error=undefined;this.#changed();
    const result=await this.#request<void>(method==='email'?'/action-proof/email/verify':'/action-proof/factor',method==='email'?{challengeToken:this.challengeToken,code}:{kind:method==='app'?'totp':'recovery',code});
    if(generation!==this.#generation)return;this.pending=false;
    if(result.ok||result.status===0||result.status>=500){this.challengeToken=undefined;await this.load();if(generation!==this.#generation)return;if(!this.status?.freshUntil)this.error='actionProofUnavailable';}
    else this.#failure(result);this.#changed();
  }
}
