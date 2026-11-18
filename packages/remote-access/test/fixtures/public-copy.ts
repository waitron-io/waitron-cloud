import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {RemoteConfigurationReconciler} from '../../src/reconciler.ts';

// Store tests need the trusted worker's completion fact; artifact delivery has its own integration tests.
export async function recordPublicCopy(pool:Pool,operationId:string){
 const {installation_id:id}=(await pool.query('SELECT installation_id FROM remote_cell_moves WHERE id=$1',[operationId])).rows[0];
 const worker=new RemoteConfigurationReconciler(pool,{execute:async job=>{assert.equal(job.kind,'certificate_public');assert.equal(job.targetId,id);}});
 await worker.schedule();await pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day'");
 await pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind='certificate_public' AND target_id=$1",[id]);assert.equal(await worker.runOnce(),true);
}
