import {addDays,type CivilDate,type PaidLevel} from './billing-calendar.ts';
import type {BillingLevel,FrozenCharge,PaymentState,TrialView,VenueBillingView} from './billing-types.ts';

export type BillingDisplayPeriod={kind:'trial'|'paid';level:PaidLevel;from:CivilDate;until:CivilDate;coversAsOf:boolean};
export type BillingDisplayV1={
 version:1;installationId:string;venueId:string;countryCode:'ES';calendarTimeZone:string;asOf:string;
 billing:{status:'ready';level:BillingLevel;state:'trial'|'active'|'payment_failing'|'lapsed';period:BillingDisplayPeriod|null}|{status:'unavailable';reason:'state_not_ready'};
 prices:{status:'published';revision:number;effectiveFrom:CivilDate;currency:'EUR';taxExclusive:true;vatRateBasisPoints:number;registeredMonthlyCents:0;connectedMonthlyCents:number;hostedMonthlyCents:number;hostedDayDivisor:30}|{status:'unavailable';reason:'not_published'};
 accountUrl:string;
};
export type BillingDisplayFacts={
 venue:VenueBillingView;trials:TrialView[];
 charges:{charge:FrozenCharge;attempts:{state:PaymentState;succeededAt:string|null}[];hostedDays:{venueId:string;on:CivilDate}[]}[];
};
type Interval=Omit<BillingDisplayPeriod,'coversAsOf'>;
const unavailable={status:'unavailable',reason:'state_not_ready'} as const;
const contains=(interval:Interval,today:CivilDate):boolean=>interval.from<=today&&today<interval.until;

export function billingDisplayDay(asOf:string,timeZone:string):CivilDate{
 const instant=new Date(asOf);
 if(!Number.isFinite(instant.getTime())||instant.toISOString()!==asOf)throw new RangeError('invalid billing instant');
 if(typeof timeZone!=='string'||!/^([A-Za-z][A-Za-z0-9_+-]*)(\/[A-Za-z0-9_+-]+)*$/.test(timeZone))throw new RangeError('invalid billing calendar');
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant);
 const part=(name:string):string=>parts.find(value=>value.type===name)!.value;
 return `${part('year').padStart(4,'0')}-${part('month')}-${part('day')}`;
}

function coalesce(intervals:Interval[]):Interval[]{
 const result:Interval[]=[];
 for(const level of ['connected','hosted'] as const){
  const ordered=intervals.filter(interval=>interval.level===level).sort((a,b)=>a.from.localeCompare(b.from)||a.until.localeCompare(b.until));
  let previous:Interval|undefined;
  for(const interval of ordered){
   if(previous&&interval.from<=previous.until){
    if(interval.until>previous.until)previous.until=interval.until;
   }else{
    previous={...interval};result.push(previous);
   }
  }
 }
 return result;
}
function select(intervals:Interval[],today:CivilDate):BillingDisplayPeriod|null{
 const current=intervals.filter(interval=>contains(interval,today));
 const candidates=current.length?current:intervals.filter(interval=>interval.until<=today);
 candidates.sort((a,b)=>b.until.localeCompare(a.until)||(a.level===b.level?0:a.level==='hosted'?-1:1));
 const chosen=candidates[0];
 return chosen?{...chosen,coversAsOf:contains(chosen,today)}:null;
}

export function projectBillingDisplay(facts:BillingDisplayFacts,today:CivilDate):BillingDisplayV1['billing']{
 const {venue,trials}=facts;
 if(!['registered','connected','hosted'].includes(venue.level))return unavailable;
 if(venue.lapsedOn!==null&&venue.lapsedOn>today)return unavailable;
 const lapsed=venue.lapsedOn!==null&&venue.lapsedOn<=today;
 if(!lapsed){
  if(trials.some(trial=>!['active','converted','lapsed'].includes(trial.state)))return unavailable;
  const active=trials.filter(trial=>trial.state==='active');
  if(active.length){
   const trial=active[0]!;
   if(active.length!==1||trial.level!==venue.level||trial.startedOn>today||trial.endsOn<=today)return unavailable;
   return {status:'ready',level:venue.level,state:'trial',period:{kind:'trial',level:trial.level,from:trial.startedOn,until:trial.endsOn,coversAsOf:true}};
  }
 }
 const relevant=facts.charges.filter(({charge,hostedDays})=>
  charge.organisationId===venue.organisationId&&charge.legalBusinessId===venue.legalBusinessId&&
  (charge.lines.some(line=>line.venueId===venue.venueId&&line.kind==='connected_month')||hostedDays.some(day=>day.venueId===venue.venueId))
 );
 // Historical first success survives a refund; only a remaining accepted success settles today.
 const settled=relevant.filter(({attempts})=>attempts.some(attempt=>attempt.state==='succeeded'&&attempt.succeededAt!==null));
 const failed=relevant.filter(entry=>!settled.includes(entry)&&entry.attempts.some(attempt=>attempt.state==='failed'||attempt.state==='refunded'));
 // Separate charges carry no reconciliation link proving an older failure was repaired.
 if(!lapsed&&failed.some(failure=>settled.some(success=>success.charge.id!==failure.charge.id&&success.charge.renewalDate>=failure.charge.renewalDate)))return unavailable;
 const intervals:Interval[]=[];
 for(const {charge,hostedDays} of settled){
  if(charge.connectedUntil!==null&&charge.renewalDate<charge.connectedUntil&&charge.lines.some(line=>line.venueId===venue.venueId&&line.kind==='connected_month')){
   intervals.push({kind:'paid',level:'connected',from:charge.renewalDate,until:charge.connectedUntil});
  }
  for(const day of hostedDays){
   if(day.venueId===venue.venueId)intervals.push({kind:'paid',level:'hosted',from:day.on,until:addDays(day.on,1)});
  }
 }
 const eligible=(interval:Interval):boolean=>venue.level===interval.level||(venue.level==='registered'&&lapsed);
 let period=select(coalesce(intervals).filter(eligible),today);
 if(lapsed&&period===null){
  period=select(trials.filter(trial=>trial.state!=='active'&&['converted','lapsed'].includes(trial.state)&&trial.startedOn<trial.endsOn&&trial.endsOn<=today)
   .map(trial=>({kind:'trial' as const,level:trial.level,from:trial.startedOn,until:trial.endsOn})).filter(eligible),today);
 }
 return {status:'ready',level:venue.level,state:lapsed?'lapsed':failed.length?'payment_failing':'active',period};
}
