import type {PoolClient} from 'pg';
import {billingDate} from './billing-config.ts';
import {BillingError,type BillingScope,type TrialView} from './billing-types.ts';
import type {TrialUsage} from './billing-trials.ts';
import {readTrafficDays} from './traffic-days.ts';

/** Call before other reads in a transaction, so stored trial, traffic and invocation facts share one snapshot. */
export async function readTrialUsage(client:PoolClient,scope:BillingScope,venueId:string,trial:TrialView):Promise<{complete:boolean;usage:TrialUsage}>{
 billingDate(trial.startedOn);billingDate(trial.endsOn);
 if(trial.startedOn>=trial.endsOn)throw new BillingError('invalid_billing_input');
 try{await client.query('SAVEPOINT billing_trial_usage');}catch(error){
  if((error as {code?:string}).code==='25P01')throw new BillingError('invalid_billing_input');throw error;
 }
 await client.query('RELEASE SAVEPOINT billing_trial_usage');
 await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
 const args=[scope.organisationId,scope.legalBusinessId,venueId];
 const venue=(await client.query('SELECT environment FROM venues WHERE organisation_id=$1 AND legal_business_id=$2 AND id=$3',args)).rows[0];
 if(!venue)throw new BillingError('billing_scope_not_found');
 if(venue.environment!=='test')throw new Error('traffic_authority_unavailable');
 const saved=(await client.query(`SELECT level,started_on::text,ends_on::text,extended,state FROM billing_trials
  WHERE organisation_id=$1 AND legal_business_id=$2 AND venue_id=$3 AND level=$4`,[...args,trial.level])).rows[0];
 if(!saved||saved.started_on!==trial.startedOn||saved.ends_on!==trial.endsOn||saved.extended!==trial.extended||saved.state!==trial.state)
  throw new BillingError('billing_state_conflict');
 const traffic=await readTrafficDays(client,scope,venueId,saved.started_on,saved.ends_on);
 const runs=(await client.query(`SELECT
  count(*) FILTER(WHERE service='content_translation' AND attempted_at>=($4::date::timestamp AT TIME ZONE 'UTC') AND attempted_at<($5::date::timestamp AT TIME ZONE 'UTC'))::int AS translations,
  count(*) FILTER(WHERE service='rota_solver' AND attempted_at>=($4::date::timestamp AT TIME ZONE 'UTC') AND attempted_at<($5::date::timestamp AT TIME ZONE 'UTC'))::int AS solvers,
  count(*) FILTER(WHERE (attempted_at IS NULL OR EXISTS(SELECT 1 FROM translation_jobs j
   WHERE j.installation_id=r.installation_id AND j.operation_id=r.operation_id AND j.venue_id=r.venue_id AND j.allowance_open_calls>0)) AND month<$5::date)::int AS uncertain
  FROM billing_allowance_reservations r WHERE organisation_id=$1 AND legal_business_id=$2 AND venue_id=$3
   AND state='spent' AND service IN ('content_translation','rota_solver')`,[...args,saved.started_on,saved.ends_on])).rows[0];
 // Even an earlier admission may first call during this trial; its month cannot establish a call date.
 return {complete:traffic.complete&&runs.uncertain===0,usage:{remoteTrafficDays:traffic.days.length,translationRuns:runs.translations,solverRuns:runs.solvers}};
}
