import type {CivilDate} from './billing-calendar.ts';
import {billingDate} from './billing-config.ts';
import {BillingError,type BillingLevel,type TrialView} from './billing-types.ts';
import type {PlanService} from './organisation-plans.ts';

export type VenueService=PlanService|'rota_solver'|'hosting';

export function levelAllows(level:BillingLevel,service:VenueService):boolean{
 if(level!=='registered'&&level!=='connected'&&level!=='hosted')return false;
 if(service==='address_lookup'||service==='transactional_email')return true;
 if(service==='hosting')return level==='hosted';
 return level!=='registered'&&['content_translation','continuous_backup','retained_snapshots','remote_access','rota_solver'].includes(service);
}

function validateFacts(base:BillingLevel,trials:readonly TrialView[],today:CivilDate):void{
 if(base!=='registered'&&base!=='connected'&&base!=='hosted')throw new BillingError('invalid_billing_input');
 billingDate(today);
 if(!Array.isArray(trials))throw new BillingError('invalid_billing_input');
 for(const trial of trials){
  if(trial===null||typeof trial!=='object'||Array.isArray(trial)
   ||(trial.level!=='connected'&&trial.level!=='hosted')
   ||!['active','converted','lapsed'].includes(trial.state)||typeof trial.extended!=='boolean'){
   throw new BillingError('invalid_billing_input');
  }
  billingDate(trial.startedOn);billingDate(trial.endsOn);
  if(trial.startedOn>=trial.endsOn)throw new BillingError('invalid_billing_input');
 }
}

export function effectiveVenueLevel(base:BillingLevel,trials:readonly TrialView[],today:CivilDate):BillingLevel{
 validateFacts(base,trials,today);
 let level=base;
 for(const trial of trials){
  if(trial.state==='active'&&trial.startedOn<=today&&today<trial.endsOn){
   if(trial.level==='hosted'||level==='registered')level=trial.level;
  }
 }
 return level;
}

export function paidGrantWindow(base:BillingLevel,trials:readonly TrialView[],today:CivilDate):{until:CivilDate|null}|null{
 validateFacts(base,trials,today);
 if(base!=='registered')return {until:null};
 const active=trials.filter(trial=>trial.state==='active').sort((a,b)=>a.startedOn.localeCompare(b.startedOn));
 let until:CivilDate|null=null;
 for(const trial of active){
  if(until===null){
   if(trial.startedOn<=today&&today<trial.endsOn)until=trial.endsOn;
  }else{
   // Touching intervals keep setup valid; the first uncovered day ends its grant.
   if(trial.startedOn>until)break;
   if(trial.endsOn>until)until=trial.endsOn;
  }
 }
 return until===null?null:{until};
}
