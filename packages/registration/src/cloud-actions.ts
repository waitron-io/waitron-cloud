import type {EmailOutbox} from './email-outbox.ts';
import type {Pool,PoolClient} from 'pg';
import {accountActionSession,requireAccountActionProof} from './account-action-proof.ts';
import {CloudActionError,readCloudActionRequests,proposeCloudAction,decideCloudAction,validateCloudActionProposal,type CloudActionProposal,type CloudActionDecision} from './cloud-action-store.ts';
import {IdentityError,resolveSession} from '@waitron-cloud/identity';
import {transaction} from './transaction.ts';

const action=(id:string,policy:'ask-first'|'act-and-report'='ask-first')=>Object.freeze({id,policy,available:false as const});
// The two exceptions allow initiation only; neither supplies hosted writer authority.
export const cloudActionCatalogue=Object.freeze([
 action('cloud_restart','act-and-report'),action('machine_replace','act-and-report'),
 action('machine_drain'),action('machine_add'),action('machine_resize'),action('hosted_restart'),action('hosted_move'),
 action('cell_create'),action('country_failover'),action('release_expand'),action('release_pause'),action('release_resume'),
 action('certificate_rotate'),action('key_rotate'),action('permission_change'),action('security_change'),
]);
export class CloudActions{
 readonly #pool:Pool;readonly #operator:string|undefined;readonly #outbox:EmailOutbox|undefined;
 constructor(pool:Pool,operatorAccountId?:string,outbox?:EmailOutbox){
  if(operatorAccountId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(operatorAccountId))throw Error('cloud_operator_account_invalid');
  this.#pool=pool;this.#operator=operatorAccountId||undefined;this.#outbox=outbox;
 }
 async #write<T>(token:string,csrfToken:string,write:(client:PoolClient,actor:string)=>Promise<T>){
  return transaction(this.#pool,async client=>{
   const session=await accountActionSession(client,token,csrfToken);
   if(!this.#operator||session.accountId!==this.#operator)throw new IdentityError('permission_denied');
   const result=await write(client,session.accountId);
   // Storage locks may wait; no decision commits on the strength of an earlier proof check.
   await requireAccountActionProof(client,token,csrfToken);return result;
  });
 }
 async propose(token:string,csrfToken:string,input:CloudActionProposal){
  validateCloudActionProposal(input);const action=cloudActionCatalogue.find(action=>action.id===input.actionId);
  if(!action)throw new CloudActionError('invalid_input');
  return this.#write(token,csrfToken,(client,actor)=>{if(!this.#outbox)throw Error('cloud_operator_notice_unavailable');return proposeCloudAction(client,input,action.policy,actor,this.#outbox);});
 }
 async decide(token:string,csrfToken:string,input:CloudActionDecision){
  return this.#write(token,csrfToken,(client,actor)=>decideCloudAction(client,input,actor));
 }
 async read(token:string){
  return transaction(this.#pool,async client=>{
   const session=await resolveSession(client,token,{touch:false});
   if(!this.#operator||session.accountId!==this.#operator)throw new IdentityError('permission_denied');
   return {actions:cloudActionCatalogue,requests:await readCloudActionRequests(client)};
  });
 }
}
