import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {BillingDisplayFacts,BillingDisplayV1} from '../src/billing-display.ts';
import type {FrozenCharge,PaymentState,TrialView,VenueBillingView} from '../src/billing-types.ts';

const modulePath='../src/'+'billing-display.ts';
const display=await import(modulePath).catch((error:NodeJS.ErrnoException)=>{
 if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
 return {};
}) as Record<string,unknown>;
function project(facts:BillingDisplayFacts,today='2026-11-10'):BillingDisplayV1['billing']{
 assert.equal(typeof display.projectBillingDisplay,'function','billing display projector must exist');
 return (display.projectBillingDisplay as (f:BillingDisplayFacts,d:string)=>BillingDisplayV1['billing'])(facts,today);
}
function day(asOf:string,zone:string):string{
 assert.equal(typeof display.billingDisplayDay,'function','billing display country calendar must exist');
 return (display.billingDisplayDay as (a:string,z:string)=>string)(asOf,zone);
}
const scope={organisationId:'organisation-a',legalBusinessId:'business-a'};
function venue(value:Partial<VenueBillingView>={}):VenueBillingView{
 return {...scope,venueId:'venue-a',revision:0,level:'registered',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null,...value};
}
function facts(value:Partial<BillingDisplayFacts>={}):BillingDisplayFacts{return {venue:venue(),trials:[],charges:[],...value};}
function trial(value:Partial<TrialView>={}):TrialView{
 return {level:'connected',startedOn:'2026-10-31',endsOn:'2026-11-30',extended:false,state:'active',...value};
}
function charge(value:Partial<FrozenCharge>={}):FrozenCharge{
 return {...scope,id:'charge-a',kind:'renewal',renewalDate:'2026-11-01',connectedUntil:'2026-12-01',window:{from:'2026-10-01',through:'2026-10-31'},price:{revision:1,effectiveFrom:'2026-10-01',currency:'EUR',prices:{connectedMonthlyCents:3000,hostedMonthlyCents:9000},vatRateBasisPoints:2100},lines:[{venueId:'venue-a',kind:'connected_month',quantity:1,cents:3000}],totals:{netCents:3000,vatCents:630,grossCents:3630},...value};
}
function attempt(state:PaymentState,succeededAt:string|null=state==='succeeded'||state==='refunded'?'2026-10-25T12:00:00.000Z':null){return {state,succeededAt};}
function paid(value:Partial<BillingDisplayFacts['charges'][number]>={}):BillingDisplayFacts['charges'][number]{return {charge:charge(),attempts:[attempt('succeeded')],hostedDays:[],...value};}
function period(kind:'trial'|'paid',level:'connected'|'hosted',from:string,until:string,coversAsOf:boolean){return {kind,level,from,until,coversAsOf};}
function ready(level:'registered'|'connected'|'hosted',state:'active'|'trial'|'lapsed'|'payment_failing',value:ReturnType<typeof period>|null=null){return {status:'ready',level,state,period:value};}
const unavailable={status:'unavailable',reason:'state_not_ready'};
const connected=()=>venue({level:'connected',revision:1,connectedFrom:'2026-11-01'});
const hosted=()=>venue({level:'hosted',revision:1});

// Removing accepted-success filtering must expose coverage from refunded attempts.
// Removing exact-day separation must bridge the unpaid 2 November in the sparse fixture.
test('known unstored owned venue is registered active without changing its facts',()=>{
 const input=facts(),before=structuredClone(input);
 assert.deepEqual(project(input),ready('registered','active'));
 assert.deepEqual(input,before);
});
for(const level of ['connected','hosted'] as const){
 test(`${level} trial uses its exact stored interval`,()=>{
  assert.deepEqual(project(facts({venue:venue({level}),trials:[trial({level})]})),ready(level,'trial',period('trial',level,'2026-10-31','2026-11-30',true)));
 });
}
test('extended trial uses the stored extension end',()=>{
 assert.deepEqual(project(facts({venue:connected(),trials:[trial({extended:true,endsOn:'2026-12-30'})]}),'2026-12-29'),ready('connected','trial',period('trial','connected','2026-10-31','2026-12-30',true)));
});
test('trial end is the first excluded day and a missing transition is unavailable',()=>{
 const input=facts({venue:connected(),trials:[trial()]});
 assert.deepEqual(project(input,'2026-11-29'),ready('connected','trial',period('trial','connected','2026-10-31','2026-11-30',true)));
 assert.deepEqual(project(input,'2026-11-30'),unavailable);
});
for(const [name,v,t] of [
 ['future trial',connected(),trial({startedOn:'2026-11-11'})],
 ['trial at another level',hosted(),trial()],
 ['registered active trial',venue(),trial()],
 ['empty trial interval',connected(),trial({endsOn:'2026-10-31'})],
] as const){test(`${name} is unavailable`,()=>assert.deepEqual(project(facts({venue:v,trials:[t]})),unavailable));}
test('future effective lapse is unavailable',()=>assert.deepEqual(project(facts({venue:venue({level:'connected',lapsedOn:'2026-11-11'})})),unavailable));
test('effective lapse precedes expired active trial and payment failures',()=>{
 assert.deepEqual(project(facts({venue:venue({level:'connected',lapsedOn:'2026-11-10'}),trials:[trial({endsOn:'2026-11-01'})],charges:[paid({attempts:[attempt('failed')]})]})),ready('connected','lapsed'));
});
test('trial precedes ambiguous failures on different charges',()=>{
 assert.deepEqual(project(facts({venue:connected(),trials:[trial()],charges:[paid({attempts:[attempt('failed')]}),paid({charge:charge({id:'charge-b'})})]})),ready('connected','trial',period('trial','connected','2026-10-31','2026-11-30',true)));
});
test('completed old trial does not hide current paid state',()=>{
 assert.deepEqual(project(facts({venue:connected(),trials:[trial({state:'converted',endsOn:'2026-11-01'})],charges:[paid()]})),ready('connected','active',period('paid','connected','2026-11-01','2026-12-01',true)));
});
test('connected paid period includes 30 November and excludes 1 December',()=>{
 const input=facts({venue:connected(),charges:[paid()]});
 assert.deepEqual(project(input,'2026-11-30'),ready('connected','active',period('paid','connected','2026-11-01','2026-12-01',true)));
 assert.deepEqual(project(input,'2026-12-01'),ready('connected','active',period('paid','connected','2026-11-01','2026-12-01',false)));
});
test('prepaid future coverage is not selected early',()=>assert.deepEqual(project(facts({venue:connected(),charges:[paid()]}),'2026-10-31'),ready('connected','active')));
for(const level of ['registered','connected','hosted'] as const){
 test(`${level} has no invented end without established coverage`,()=>{
  assert.deepEqual(project(facts({venue:venue({level}),charges:[paid({attempts:[attempt('pending')]})]})),ready(level,'active'));
 });
}
for(const state of ['failed','refunded'] as const){
 test(`${state} with pending retry still signals payment failing without coverage`,()=>{
  assert.deepEqual(project(facts({venue:connected(),charges:[paid({attempts:[attempt(state),attempt('pending')]})]})),ready('connected','payment_failing'));
 });
}
test('billing display requires remaining accepted success',()=>{
 assert.deepEqual(project(facts({venue:connected(),charges:[paid({attempts:[attempt('refunded')]})]})),ready('connected','payment_failing'));
 assert.deepEqual(project(facts({venue:connected(),charges:[paid({attempts:[attempt('succeeded',null)]})]})),ready('connected','active'));
});
test('later accepted success on the same charge restores coverage after first refund',()=>{
 assert.deepEqual(project(facts({venue:connected(),charges:[paid({attempts:[attempt('refunded'),attempt('failed'),attempt('succeeded','2026-11-03T12:00:00.000Z')]})]})),ready('connected','active',period('paid','connected','2026-11-01','2026-12-01',true)));
});
test('raw failed and refunded observations cannot replace accepted success',()=>{
 const accepted={...attempt('succeeded'),observations:[{state:'failed'},{state:'refunded'}]};
 assert.deepEqual(project(facts({venue:connected(),charges:[paid({attempts:[accepted]})]})),ready('connected','active',period('paid','connected','2026-11-01','2026-12-01',true)));
});
const sparse=()=>paid({charge:charge({connectedUntil:null,lines:[{venueId:'venue-a',kind:'hosted_days',quantity:2,cents:600}]}),hostedDays:[{venueId:'venue-a',on:'2026-11-01'},{venueId:'venue-a',on:'2026-11-03'}]});
test('billing display preserves exact hosted day holes',()=>{
 const input=facts({venue:hosted(),charges:[sparse()]});
 assert.deepEqual(project(input,'2026-11-02'),ready('hosted','active',period('paid','hosted','2026-11-01','2026-11-02',false)));
 assert.deepEqual(project(input,'2026-11-03'),ready('hosted','active',period('paid','hosted','2026-11-03','2026-11-04',true)));
});
test('adjacent settled hosted days from different charges coalesce without mutating input',()=>{
 const first=sparse(),input=facts({venue:hosted(),charges:[first,paid({charge:charge({id:'charge-b',lines:[]}),hostedDays:[{venueId:'venue-a',on:'2026-11-02'}]})]}),before=structuredClone(input);
 assert.deepEqual(project(input,'2026-11-02'),ready('hosted','active',period('paid','hosted','2026-11-01','2026-11-04',true)));
 assert.deepEqual(input,before);
});
for(const [name,bridge] of [
 ['another venue',paid({hostedDays:[{venueId:'venue-b',on:'2026-11-02'}]})],
 ['another level',paid()],
 ['an unpaid day',paid({charge:charge({id:'charge-b',renewalDate:'2026-10-01'}),attempts:[attempt('pending')],hostedDays:[{venueId:'venue-a',on:'2026-11-02'}]})],
] as const){test(`${name} cannot bridge a hosted gap`,()=>{
 assert.deepEqual(project(facts({venue:hosted(),charges:[sparse(),bridge]}),'2026-11-02'),ready('hosted','active',period('paid','hosted','2026-11-01','2026-11-02',false)));
});}
test('zero-cent omitted hosted line still has its exact settled allocations',()=>{
 assert.deepEqual(project(facts({venue:hosted(),charges:[paid({charge:charge({lines:[],totals:{netCents:0,vatCents:0,grossCents:0}}),hostedDays:[{venueId:'venue-a',on:'2026-11-10'}]})]})),ready('hosted','active',period('paid','hosted','2026-11-10','2026-11-11',true)));
});
test('historical connected credit and its later refund do not settle a hosted charge',()=>{
 const creditedDay={venueId:'venue-a',on:'2026-11-10',coveredByChargeId:'connected-credit'};
 assert.deepEqual(project(facts({venue:hosted(),charges:[paid({charge:charge({id:'connected-credit',renewalDate:'2026-10-01'}),attempts:[attempt('refunded')]}),paid({charge:charge({id:'hosted-bill',lines:[]}),attempts:[attempt('pending')],hostedDays:[creditedDay]})]})),ready('hosted','payment_failing'));
});
test('refunded connected credit cannot revoke independently settled hosted days',()=>{
 assert.deepEqual(project(facts({venue:hosted(),charges:[paid({charge:charge({id:'hosted-bill',lines:[]}),hostedDays:[{venueId:'venue-a',on:'2026-11-10',coveredByChargeId:'refunded-credit'} as {venueId:string;on:string}]})]})),ready('hosted','active',period('paid','hosted','2026-11-10','2026-11-11',true)));
});
for(const level of ['connected','hosted'] as const){
 test(`business total without this venue line or allocation gives no ${level} coverage or failure`,()=>{
  const other=charge({lines:[{venueId:'venue-b',kind:'connected_month',quantity:1,cents:3000}]});
  for(const state of ['succeeded','failed','refunded'] as const)assert.deepEqual(project(facts({venue:venue({level}),charges:[paid({charge:other,attempts:[attempt(state)],hostedDays:[{venueId:'venue-b',on:'2026-11-10'}]})]})),ready(level,'active'));
 });
}
test('charges in another business or organisation cannot contribute coverage or failure',()=>{
 for(const patch of [{organisationId:'organisation-b'},{legalBusinessId:'business-b'}])for(const state of ['succeeded','failed'] as const){
  assert.deepEqual(project(facts({venue:connected(),charges:[paid({charge:charge(patch),attempts:[attempt(state)]})]})),ready('connected','active'));
 }
});
for(const renewalDate of ['2026-11-01','2026-12-01']){
 test(`unresolved failure beside different settled charge on ${renewalDate} is unavailable`,()=>{
  assert.deepEqual(project(facts({venue:connected(),charges:[paid({attempts:[attempt('failed')]}),paid({charge:charge({id:'charge-b',renewalDate,connectedUntil:'2027-01-01'})})]})),unavailable);
 });
}
test('earlier unrelated success does not establish recovery from later refund',()=>{
 assert.deepEqual(project(facts({venue:connected(),charges:[paid({charge:charge({renewalDate:'2026-10-01',connectedUntil:'2026-11-01'})}),paid({charge:charge({id:'charge-b'}),attempts:[attempt('refunded')]})]})),ready('connected','payment_failing',period('paid','connected','2026-10-01','2026-11-01',false)));
});
test('another venue settlement cannot make unresolved recovery ambiguous',()=>{
 assert.deepEqual(project(facts({venue:connected(),charges:[paid({attempts:[attempt('failed')]}),paid({charge:charge({id:'charge-b',lines:[{venueId:'venue-b',kind:'connected_month',quantity:1,cents:3000}]})})]})),ready('connected','payment_failing'));
});
test('lapse takes precedence over ambiguous charge recovery',()=>{
 assert.deepEqual(project(facts({venue:venue({level:'connected',lapsedOn:'2026-11-10'}),charges:[paid({attempts:[attempt('failed')]}),paid({charge:charge({id:'charge-b'})})]})),ready('connected','lapsed',period('paid','connected','2026-11-01','2026-12-01',true)));
});
test('registered active and failing states never expose old paid periods',()=>{
 assert.deepEqual(project(facts({charges:[paid()]})),ready('registered','active'));
 assert.deepEqual(project(facts({charges:[paid({attempts:[attempt('failed')]})]})),ready('registered','payment_failing'));
});
test('registered lapse selects latest paid end and hosted on same-end tie',()=>{
 const input=facts({venue:venue({lapsedOn:'2026-11-10'}),charges:[paid(),paid({charge:charge({id:'hosted',lines:[]}),hostedDays:[{venueId:'venue-a',on:'2026-11-30'}]})]});
 assert.deepEqual(project(input,'2026-12-02'),ready('registered','lapsed',period('paid','hosted','2026-11-30','2026-12-01',false)));
});
test('lapsed paid level selects only matching paid coverage',()=>{
 assert.deepEqual(project(facts({venue:venue({level:'connected',lapsedOn:'2026-11-10'}),charges:[sparse()]})),ready('connected','lapsed'));
});
test('lapsed venue falls back to completed trial only without selected paid interval',()=>{
 const input=facts({venue:venue({lapsedOn:'2026-11-10'}),trials:[trial({state:'lapsed',endsOn:'2026-11-01'})]});
 assert.deepEqual(project(input),ready('registered','lapsed',period('trial','connected','2026-10-31','2026-11-01',false)));
 assert.deepEqual(project({...input,charges:[paid({charge:charge({renewalDate:'2026-09-01',connectedUntil:'2026-10-01'})})]}),ready('registered','lapsed',period('paid','connected','2026-09-01','2026-10-01',false)));
});
test('lapsed trial fallback cannot select active future or different-level trials',()=>{
 const v=venue({level:'hosted',lapsedOn:'2026-11-10'});
 for(const t of [trial({state:'lapsed',endsOn:'2026-11-01'}),trial({level:'hosted'}),trial({level:'hosted',state:'converted',endsOn:'2026-11-11'})])assert.deepEqual(project(facts({venue:v,trials:[t]})),ready('hosted','lapsed'));
});
test('scheduled cancellation preserves the current level and established coverage',()=>{
 assert.deepEqual(project(facts({venue:venue({...connected(),scheduledLevel:'registered',scheduledOn:'2026-12-01'}),charges:[paid()]})),ready('connected','active',period('paid','connected','2026-11-01','2026-12-01',true)));
});
test('hosted to connected change cannot turn hosted coverage into connected coverage',()=>assert.deepEqual(project(facts({venue:connected(),charges:[sparse()]})),ready('connected','active')));
test('unknown stored level or trial state is unavailable',()=>{
 assert.deepEqual(project(facts({venue:venue({level:'unknown' as 'connected'})})),unavailable);
 assert.deepEqual(project(facts({venue:connected(),trials:[trial({state:'unknown' as 'active'})]})),unavailable);
});
test('country day crosses local midnight using the explicitly supplied calendar',()=>{
 assert.equal(day('2026-11-01T22:59:59.999Z','Europe/Madrid'),'2026-11-01');
 assert.equal(day('2026-11-01T23:00:00.000Z','Europe/Madrid'),'2026-11-02');
 assert.equal(day('2026-11-01T23:00:00.000Z','America/New_York'),'2026-11-01');
});
test('country day handles both daylight saving transitions',()=>{
 for(const instant of ['2026-03-29T00:59:59.999Z','2026-03-29T01:00:00.000Z'])assert.equal(day(instant,'Europe/Madrid'),'2026-03-29');
 for(const instant of ['2026-10-25T00:59:59.999Z','2026-10-25T01:00:00.000Z'])assert.equal(day(instant,'Europe/Madrid'),'2026-10-25');
 assert.equal(day('2026-03-29T22:00:00.000Z','Europe/Madrid'),'2026-03-30');
 assert.equal(day('2026-10-25T22:00:00.000Z','Europe/Madrid'),'2026-10-25');
});
for(const instant of ['garbage','2026-02-30T12:00:00.000Z','2026-11-01','2026-11-01T12:00:00+01:00'])test(`invalid noncanonical server instant ${instant} is rejected`,()=>{
 assert.equal(typeof display.billingDisplayDay,'function','billing display country calendar must exist');
 assert.throws(()=>day(instant,'Europe/Madrid'));
});
for(const zone of ['','Europe/Imaginary','+01:00'])test(`invalid or implicit country zone ${JSON.stringify(zone)} is rejected`,()=>{
 assert.equal(typeof display.billingDisplayDay,'function','billing display country calendar must exist');
 assert.throws(()=>day('2026-11-01T12:00:00.000Z',zone));
});

test('connected intervals coalesce only across overlapping or adjacent paid coverage',()=>{
 const a=paid({charge:charge({id:'a',renewalDate:'2026-09-01',connectedUntil:'2026-10-01'})});
 const b=paid({charge:charge({id:'b',renewalDate:'2026-10-01',connectedUntil:'2026-11-01'})});
 const c=paid({charge:charge({id:'c',renewalDate:'2026-10-15',connectedUntil:'2026-12-01'})});
 const d=paid({charge:charge({id:'d',renewalDate:'2027-01-01',connectedUntil:'2027-02-01'})});
 assert.deepEqual(project(facts({venue:connected(),charges:[d,c,a,b]})),ready('connected','active',period('paid','connected','2026-09-01','2026-12-01',true)));
});
test('a current interval wins over a later prepaid interval and latest historical end wins otherwise',()=>{
 const charges=[paid({charge:charge({id:'future',renewalDate:'2027-01-01',connectedUntil:'2027-02-01'})}),paid({charge:charge({id:'old',renewalDate:'2026-09-01',connectedUntil:'2026-10-01'})}),paid()];
 assert.deepEqual(project(facts({venue:connected(),charges})),ready('connected','active',period('paid','connected','2026-11-01','2026-12-01',true)));
 assert.deepEqual(project(facts({venue:connected(),charges}),'2026-12-15'),ready('connected','active',period('paid','connected','2026-11-01','2026-12-01',false)));
});
test('registered lapse chooses latest completed trial and hosted for same-end fallback',()=>{
 const trials=[trial({state:'converted',startedOn:'2026-09-01',endsOn:'2026-10-01'}),trial({state:'lapsed',endsOn:'2026-11-01'}),trial({level:'hosted',state:'lapsed',endsOn:'2026-11-01'})];
 assert.deepEqual(project(facts({venue:venue({lapsedOn:'2026-11-10'}),trials})),ready('registered','lapsed',period('trial','hosted','2026-10-31','2026-11-01',false)));
});
test('registered lapse prefers the latest paid end regardless of level',()=>{
 assert.deepEqual(project(facts({venue:venue({lapsedOn:'2026-11-10'}),charges:[sparse(),paid()]})),ready('registered','lapsed',period('paid','connected','2026-11-01','2026-12-01',true)));
});
test('multiple active trials cannot manufacture a current trial',()=>assert.deepEqual(project(facts({venue:connected(),trials:[trial(),trial({level:'hosted'})]})),unavailable));
test('invalid connected boundaries cannot manufacture a paid interval',()=>{
 for(const connectedUntil of [null,'2026-11-01','2026-10-31'])assert.deepEqual(project(facts({venue:connected(),charges:[paid({charge:charge({connectedUntil})})]})),ready('connected','active'));
});
test('a hosted line without consumed day allocations cannot manufacture coverage',()=>{
 assert.deepEqual(project(facts({venue:hosted(),charges:[paid({charge:charge({lines:[{venueId:'venue-a',kind:'hosted_days',quantity:30,cents:9000}]})})]})),ready('hosted','active'));
});
