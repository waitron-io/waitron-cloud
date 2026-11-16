import type {Pool} from 'pg';
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
 readonly #pool:Pool;readonly #operator:string|undefined;
 constructor(pool:Pool,operatorAccountId?:string){
  if(operatorAccountId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(operatorAccountId))throw Error('cloud_operator_account_invalid');
  this.#pool=pool;this.#operator=operatorAccountId||undefined;
 }
 async read(token:string){
  return transaction(this.#pool,async client=>{
   const session=await resolveSession(client,token,{touch:false});
   if(!this.#operator||session.accountId!==this.#operator)throw new IdentityError('permission_denied');
   return {actions:cloudActionCatalogue};
  });
 }
}
