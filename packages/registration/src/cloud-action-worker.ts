import type {Pool} from 'pg';
import {cloudActionCatalogue} from './cloud-actions.ts';
import {readCloudActionRequest,type CloudActionRequest} from './cloud-action-store.ts';
import {transaction} from './transaction.ts';

export function cloudActionDemoEnabled(environment:Record<string,string|undefined>){
 const flag=environment.CLOUD_ACTION_DEMO??'0';
 if(!['0','1'].includes(flag)||flag==='1'&&environment.NODE_ENV==='production')throw Error('cloud_action_demo_refused');
 return flag==='1';
}
export interface CloudActionDemoExecutor{
 eligible(request:CloudActionRequest):Promise<boolean>;
 restart(request:CloudActionRequest):Promise<void>;
 observe(effectId:string):Promise<'confirmed'|'unknown'>;
}
export class CloudActionWorker{
 readonly pool:Pool;readonly options:{demo?:boolean;operatorAccountId?:string;executor:CloudActionDemoExecutor};
 constructor(pool:Pool,options:CloudActionWorker['options']){this.pool=pool;this.options=options;}
 async runOnce():Promise<boolean>{
  if(!this.options.demo||process.env.NODE_ENV==='production'||!this.options.operatorAccountId)return false;
  const candidates=(await this.pool.query(`SELECT id FROM cloud_action_requests WHERE outcome IS NULL
   AND (dispatch_started_at IS NOT NULL OR state='pending' AND action_id='cloud_restart') ORDER BY created_at,id LIMIT 50`)).rows;
  for(const {id} of candidates){
   const claimed=await transaction(this.pool,async client=>{
    const initial=await readCloudActionRequest(client,id);
    // Lock the cell before its request so independent workers share the same disruption boundary.
    if(!(await client.query("SELECT pg_try_advisory_xact_lock(hashtext('cloud-action-cell'),hashtext($1)) AS locked",[initial.cell])).rows[0].locked)return;
    const row=(await client.query('SELECT * FROM cloud_action_requests WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(row.outcome)return;
    if(row.dispatch_started_at)return {request:initial,dispatch:false};
    const policy=cloudActionCatalogue.find(action=>action.id===row.action_id);
    if(row.state!=='pending'||row.action_id!=='cloud_restart'||!policy||row.policy!==policy.policy||policy.policy!=='act-and-report')return;
    if((await client.query('SELECT id FROM cloud_action_requests WHERE cell=$1 AND dispatch_started_at IS NOT NULL AND outcome IS NULL AND id<>$2 LIMIT 1',[row.cell,id])).rowCount)return;
    if(!await this.options.executor.eligible(initial))return;
    // Inspection can wait: the configured country account must still exist and be enabled afterwards.
    const operator=await client.query('SELECT id FROM cloud_accounts WHERE id=$1 AND disabled_at IS NULL FOR SHARE',[this.options.operatorAccountId]);
    if(!operator.rowCount)return;
    await client.query('UPDATE cloud_action_requests SET dispatch_started_at=clock_timestamp() WHERE id=$1',[id]);
    return {request:initial,dispatch:true};
   });
   if(!claimed)continue;
   // A committed marker authorises this one call only. All subsequent passes observe that identity.
   if(claimed.dispatch)await this.options.executor.restart(claimed.request);
   const status=await this.options.executor.observe(claimed.request.effectId);
   if(status==='confirmed'){
    await this.pool.query("UPDATE cloud_action_requests SET outcome=$2::jsonb WHERE id=$1 AND outcome IS NULL",[id,JSON.stringify({status})]);
    return true;
   }
  }
  return false;
 }
}
