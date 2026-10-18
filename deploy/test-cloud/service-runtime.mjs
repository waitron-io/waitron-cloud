import {transaction} from '../../packages/registration/src/transaction.ts';
import {readVenuePlan} from '../../packages/registration/src/organisation-plans.ts';
import {openStorageAuthority} from './storage-authority.mjs';

// Provider work runs without database locks. The final policy read checks the
// original revision; a free/paid toggle must not revive a prior writer generation.
export async function openPlanStorage({pool,mode,...options}){
 if(mode!=='test-free-paid')throw Error('test_cloud.plan_mode');
 async function policy(venueId){
  return transaction(pool,async client=>{
   if(await readVenuePlan(client,venueId,mode)!=='paid')throw Error('permission_denied');
   const row=(await client.query('SELECT o.service_plan_revision FROM organisations o JOIN venues v ON v.organisation_id=o.id WHERE v.id=$1',[venueId])).rows[0];
   if(!row)throw Error('permission_denied');return row.service_plan_revision;
  });
 }
 const authority=await openStorageAuthority({...options,authorizeWriter:async(id,revision)=>{try{return await policy(id)===revision;}catch(error){if(error?.message==='permission_denied')return false;throw error;}}});
 return {
  async provision(input){
   const revision=await policy(input.venueId),result=await authority.provision({...input,policyRevision:revision});
   try{if(await policy(input.venueId)!==revision)throw Error('permission_denied');return result;}
   catch(error){await authority.withdrawWriter(input.venueId,revision);throw error;}
  },
  async reader(input){await policy(input.venueId);const result=await authority.reader(input);await policy(input.venueId);return result;},
  read:(...args)=>authority.read(...args),
  withdrawWriter:(...args)=>authority.withdrawWriter(...args),
  reconcile:()=>authority.reconcile()
 };
}
