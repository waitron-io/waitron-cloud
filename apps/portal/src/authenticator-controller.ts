import {accountRequest,type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
import type {FactorChallenge,FactorChange,FactorEnrolment,FactorProof,FactorStatus,PasswordLogin} from './authenticator-types.ts';
type Request=<T>(path:string,body?:Record<string,unknown>)=>Promise<ApiResult<T>>;
const normaliseCode=(code:string)=>code.replace(/\s/g,'');
const validCode=(code:string,kind:FactorProof['kind'])=>kind==='totp'?/^\d{6}$/.test(code):/^(?:[A-Fa-f0-9]{32}|[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{8}){3})$/.test(code);
export class AuthenticatorController {
  challenge:FactorChallenge|undefined;
  enrolment:FactorEnrolment|undefined;
  status:FactorStatus|undefined;
  password='';proofKind:FactorProof['kind']='totp';proofCode='';confirmation='';
  pending=false;loaded=false;retryAt=0;error:keyof Copy|undefined;
  requiredField:'password'|'proof'|'confirmation'|undefined;
  #account:string|undefined;#generation=0;#request:Request;#changed:()=>void;
  constructor(changed:()=>void,request:Request=accountRequest){this.#changed=changed;this.#request=request;}
  #clearInput(){this.password='';this.proofCode='';this.confirmation='';}
  fence(){this.#generation++;this.pending=false;this.loaded=false;this.error=undefined;this.requiredField=undefined;this.challenge=undefined;this.enrolment=undefined;this.status=undefined;this.#clearInput();}
  account(id:string|undefined){if(id===this.#account)return;this.#account=id;this.fence();}
  #failure(result:Extract<ApiResult<unknown>,{ok:false}>,change=false){
    this.retryAt=Date.now()+result.retryAfterMs;
    this.error=result.status===429?'limited':result.code==='credentials_invalid'?'credentials':result.status===403?'forbidden'
      :change&&(result.status===0||result.status>=500)?'factorChangeUncertain':'factorUnavailable';
  }
  #managementFailure(result:Extract<ApiResult<unknown>,{ok:false}>,change=false){
    this.#failure(result,change);
    if(result.status===400&&result.code==='invalid_input')this.error='factorCheckSettings';
  }
  #start(){if(this.pending||Date.now()<this.retryAt)return undefined;this.pending=true;this.error=undefined;this.requiredField=undefined;this.#changed();return this.#generation;}
  #required(error:'requiredPassword'|'factorCodeRequired'|'factorCodeInvalid'|'factorConfirmationInvalid',field:NonNullable<AuthenticatorController['requiredField']>){if(!this.pending&&Date.now()>=this.retryAt){this.error=error;this.requiredField=field;this.#changed();}return false as const;}
  async startLogin(email:string,password:string):Promise<'authenticated'|'factor'|'reconcile'|false>{
    const generation=this.#start();if(generation===undefined)return false;
    this.challenge=undefined;this.#clearInput();
    const result=await this.#request<PasswordLogin>('/login',{email,password});
    if(generation!==this.#generation)return false;this.pending=false;
    if(result.ok){if('factorRequired' in result.value){this.challenge=result.value;this.#changed();return 'factor';}this.#changed();return 'authenticated';}
    this.#failure(result);if(this.error==='factorUnavailable')this.error=result.status===400?'invalid':'unavailable';this.#changed();return result.status===0||result.status>=500?'reconcile':false;
  }
  async completeLogin():Promise<'authenticated'|'reconcile'|false>{
    const code=normaliseCode(this.proofCode);if(!this.challenge)return false;if(!code)return this.#required('factorCodeRequired','proof');
    if(!validCode(code,this.proofKind))return this.#required('factorCodeInvalid','proof');
    const generation=this.#start();if(generation===undefined)return false;
    const body={challengeToken:this.challenge.challengeToken,proof:{kind:this.proofKind,code}};this.#clearInput();
    const result=await this.#request<{accountId:string}>('/login/factor',body);
    if(generation!==this.#generation)return false;this.pending=false;
    if(result.ok){this.challenge=undefined;this.#changed();return 'authenticated';}
    this.#failure(result);
    // An uncertain completion may have consumed its proof; only a session read can reconcile it.
    if(result.status===0||result.status>=500){this.challenge=undefined;this.error='factorLoginUncertain';this.#changed();return 'reconcile';}
    if(result.status===401){this.challenge=undefined;this.#changed();return 'reconcile';}this.#changed();return false;
  }
  async load(){if(!this.#account)return;const generation=this.#start();if(generation===undefined)return;
    const result=await this.#request<FactorStatus>('/authenticator');if(generation!==this.#generation)return;
    this.pending=false;this.loaded=result.ok;if(result.ok)this.status=result.value;else this.#failure(result);this.#changed();}
  async refresh(){
    if(!this.#account||this.pending||Date.now()<this.retryAt)return;
    this.enrolment=undefined;this.status=undefined;this.loaded=false;this.#clearInput();
    await this.load();
  }
  #authority(){if(!this.password){this.#required('requiredPassword','password');return undefined;}
    const code=normaliseCode(this.proofCode);if(this.status?.active&&!code){this.#required('factorCodeRequired','proof');return undefined;}
    if(this.status?.active&&!validCode(code,this.proofKind)){this.#required('factorCodeInvalid','proof');return undefined;}
    return {password:this.password,...(this.status?.active?{proof:{kind:this.proofKind,code}}:{})};}
  async begin(){if(!this.#account)return;const body=this.#authority();if(!body)return;
    const generation=this.#start();if(generation===undefined)return;
    this.#clearInput();const result=await this.#request<FactorEnrolment>('/authenticator/begin',body);
    if(generation!==this.#generation)return;this.pending=false;this.enrolment=undefined;
    if(result.ok)this.enrolment=result.value;else this.#managementFailure(result,true);this.#changed();}
  async #change(action:'activate'|'remove'|'regenerate'):Promise<FactorChange|'reconcile'|false>{
    const code=normaliseCode(this.confirmation);
    if(!this.#account||action==='activate'&&!this.enrolment)return false;
    const authority=this.#authority();if(!authority)return false;
    if(action==='activate'&&!code)return this.#required('factorCodeRequired','confirmation');
    if(action==='activate'&&!validCode(code,'totp'))return this.#required('factorConfirmationInvalid','confirmation');
    const generation=this.#start();if(generation===undefined)return false;
    const body={...authority,...(action==='activate'?{pendingToken:this.enrolment!.pendingToken,code}:{})};this.#clearInput();
    const result=await this.#request<FactorChange>(`/authenticator/${action}`,body);
    if(generation!==this.#generation)return false;this.pending=false;
    if(result.ok){this.fence();this.#changed();return result.value;}
    this.#managementFailure(result,true);
    if(result.status===403&&result.code==='credentials_invalid'){
      this.pending=true;const session=await this.#request<{accountId:string}>('/session');
      if(generation!==this.#generation)return false;this.pending=false;
      // Browsers can repeat a connection-lost POST; its refusal can follow a committed self-revocation.
      if(!session.ok||session.value.accountId!==this.#account){this.enrolment=undefined;this.error='factorChangeUncertain';this.#changed();return 'reconcile';}
    }
    if(result.status===0||result.status>=500){this.challenge=undefined;this.enrolment=undefined;this.#changed();return 'reconcile';}
    this.#changed();return false;
  }
  activate(){return this.#change('activate');}remove(){return this.#change('remove');}regenerate(){return this.#change('regenerate');}
  async cancel(){if(!this.#account||!this.enrolment)return;const generation=this.#start();if(generation===undefined)return;
    const pendingToken=this.enrolment.pendingToken;this.#clearInput();const result=await this.#request<void>('/authenticator/cancel',{pendingToken});
    if(generation!==this.#generation)return;this.pending=false;this.enrolment=undefined;if(!result.ok)this.#managementFailure(result);this.#changed();}
}
