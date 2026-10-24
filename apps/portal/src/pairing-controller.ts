import {accountRequest,type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
import type {PairingBusiness,PairingView} from './pairing-types.ts';
export class PairingController {
  requestId:string|undefined;code='';businesses:PairingBusiness[]=[];selected='';view:PairingView|undefined;
  pending=false;loaded=false;codeError=false;error:keyof Copy|undefined;retryAt=0;
  #account:string|undefined;#generation=0;#changed:()=>void;#request:typeof accountRequest;
  constructor(changed:()=>void,request:typeof accountRequest=accountRequest){this.#changed=changed;this.#request=request;}
  #clear(){this.#generation++;this.code='';this.businesses=[];this.selected='';this.view=undefined;this.pending=false;this.loaded=false;this.codeError=false;this.error=undefined;}
  open(id:string|undefined){if(id!==this.requestId){this.#clear();this.requestId=id;}}
  account(id:string|undefined){if(id!==this.#account){this.#clear();this.#account=id;}}
  get waiting(){return Math.max(0,Math.ceil((this.retryAt-Date.now())/1000));}
  #ready(){return !!this.requestId&&!!this.#account&&!this.pending&&!this.waiting;}
  #failure(result:Extract<ApiResult<unknown>,{ok:false}>,write=false){
    this.retryAt=Math.max(this.retryAt,Date.now()+result.retryAfterMs);
    this.error=result.status===429?'limited':result.status===401?'pairSession':result.code==='pairing_unavailable'?'pairUnavailable'
      :result.status===403||result.code==='binding_conflict'?'pairPermission':write&&(result.status===0||result.status>=500)?'pairUncertain':'unavailable';
  }
  async load(){
    if(!this.#ready())return;this.pending=true;this.error=undefined;const generation=this.#generation;this.#changed();
    const result=await this.#request<{businesses:PairingBusiness[]}>('/pairing/businesses');
    if(generation!==this.#generation)return;this.pending=false;
    if(result.ok){this.businesses=result.value.businesses;this.selected=this.businesses.length===1?this.businesses[0]!.legalBusinessId:'';this.loaded=true;}
    else this.#failure(result);this.#changed();
  }
  async inspect(){await this.#exchange(false);}
  async approve(){await this.#exchange(true);}
  async #exchange(approve:boolean){
    if(!this.#ready())return;
    this.code=this.code.trim();
    this.error=undefined;this.codeError=!/^\d{8}$/.test(this.code);
    if(this.codeError){this.error='pairCodeError';this.#changed();return;}
    const chosen=this.businesses.find(b=>b.legalBusinessId===this.selected);
    if(approve&&(!chosen||this.view?.state!=='awaiting_cloud')){this.error='pairChoice';this.#changed();return;}
    const body:Record<string,string>={requestId:this.requestId!,code:this.code};
    if(approve){body.organisationId=chosen!.organisationId;body.legalBusinessId=chosen!.legalBusinessId;}
    const prior=this.view;this.pending=true;const generation=this.#generation;this.#changed();
    const result=await this.#request<PairingView>(approve?'/pairing/approve':'/pairing/inspect',body);
    if(generation!==this.#generation)return;this.pending=false;
    if(result.ok){
      const v=result.value;
      if(v.requestId!==this.requestId||(prior&&v.localVenueId!==prior.localVenueId)
        ||(approve&&(v.organisationId!==chosen!.organisationId||v.legalBusinessId!==chosen!.legalBusinessId||v.state==='awaiting_cloud')))this.error='unavailable';
      else this.view=v;
    }else this.#failure(result,approve);
    this.#changed();
  }
}
