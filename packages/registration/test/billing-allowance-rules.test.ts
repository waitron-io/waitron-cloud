import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {BillingLevel,TrialView} from '../src/billing-types.ts';

const TEST_ALLOWANCES={revision:1,effectiveFrom:'2026-10-01',limits:{
 registered:{transactional_email:'2',address_lookup:'2',sms:'0',content_translation:'0',rota_solver:'0'},
 connected:{transactional_email:'4',address_lookup:'4',sms:'0',content_translation:'6',rota_solver:'4'},
 hosted:{transactional_email:'6',address_lookup:'6',sms:'0',content_translation:'8',rota_solver:'6'},
},unpaidTrial:{content_translation:'2',rota_solver:'1'}};
const trial:TrialView={level:'connected',startedOn:'2026-10-31',endsOn:'2026-11-30',extended:false,state:'active'};
const input={base:'registered' as BillingLevel,trials:[trial],day:'2026-11-29',hasPaymentMethod:false,service:'content_translation'};
type Api={validateAllowanceVersion(value:unknown):typeof TEST_ALLOWANCES;allowanceMonth(day:string):{from:string;until:string};allowanceLimit(config:unknown,input:unknown):bigint};
async function api():Promise<Api>{
 let module:Record<string,unknown>;
 try{module=await import(new URL('../src/billing-allowance-rules.ts',import.meta.url).href);}
 catch(error){if((error as {code?:string}).code!=='ERR_MODULE_NOT_FOUND')throw error;module={};}
 for(const name of ['validateAllowanceVersion','allowanceMonth','allowanceLimit','AllowanceError'])assert.equal(typeof module[name],'function',`${name} must implement the published allowance contract`);
 return module as unknown as Api;
}

test('published allowance configuration preserves explicit zeros and owns its nested values',async()=>{
 const {validateAllowanceVersion:validate}=await api(),value=validate(TEST_ALLOWANCES);
 assert.deepEqual(value,TEST_ALLOWANCES);value.limits.connected.transactional_email='99';value.unpaidTrial.rota_solver='0';
 assert.equal(TEST_ALLOWANCES.limits.connected.transactional_email,'4');assert.equal(TEST_ALLOWANCES.unpaidTrial.rota_solver,'1');
 assert.equal(validate(TEST_ALLOWANCES).limits.registered.sms,'0');
});

test('allowance configuration has no implicit production values',async()=>{
 const {validateAllowanceVersion:validate}=await api();
 const bad:unknown[]=[undefined,null,[],{}, {...TEST_ALLOWANCES,revision:0},{...TEST_ALLOWANCES,revision:1.5},{...TEST_ALLOWANCES,revision:Number.MAX_SAFE_INTEGER+1},
  {...TEST_ALLOWANCES,effectiveFrom:'2026-10-02'},{...TEST_ALLOWANCES,effectiveFrom:'2026-02-30'}, {...TEST_ALLOWANCES,effectiveFrom:'0000-01-01'},
  {...TEST_ALLOWANCES,effectiveFrom:'2026-10-01\n'},{...TEST_ALLOWANCES,production:true}];
 for(const key of Object.keys(TEST_ALLOWANCES)){const value:Record<string,unknown>=structuredClone(TEST_ALLOWANCES);delete value[key];bad.push(value);}
 for(const value of ['01','1.5','-1','', '2\n','+2',' 2','9223372036854775808',2,null,undefined])bad.push({...TEST_ALLOWANCES,limits:{...TEST_ALLOWANCES.limits,connected:{...TEST_ALLOWANCES.limits.connected,transactional_email:value}}});
 bad.push({...TEST_ALLOWANCES,limits:{...TEST_ALLOWANCES.limits,enterprise:TEST_ALLOWANCES.limits.hosted}},
  {...TEST_ALLOWANCES,limits:{...TEST_ALLOWANCES.limits,connected:{...TEST_ALLOWANCES.limits.connected,unknown:'1'}}},
  {...TEST_ALLOWANCES,limits:{...TEST_ALLOWANCES.limits,connected:{...TEST_ALLOWANCES.limits.connected,rota_solver:undefined}}},
  {...TEST_ALLOWANCES,unpaidTrial:{content_translation:'7',rota_solver:'1'}},
  {...TEST_ALLOWANCES,unpaidTrial:{content_translation:'2',rota_solver:'5'}},
  {...TEST_ALLOWANCES,limits:{...TEST_ALLOWANCES.limits,hosted:{...TEST_ALLOWANCES.limits.hosted,content_translation:'1'}}},
  {...TEST_ALLOWANCES,unpaidTrial:{...TEST_ALLOWANCES.unpaidTrial,sms:'0'}});
 for(const value of bad)assert.throws(()=>validate(value),{name:'AllowanceError',code:'invalid_allowance_input',message:'invalid_allowance_input'});
});

test('allowance configuration retains signed bigint precision at the boundary',async()=>{
 const {validateAllowanceVersion:validate,allowanceLimit}=await api();
 const value={...TEST_ALLOWANCES,limits:{...TEST_ALLOWANCES.limits,hosted:{...TEST_ALLOWANCES.limits.hosted,transactional_email:'9223372036854775807'}}};
 assert.equal(validate(value).limits.hosted.transactional_email,'9223372036854775807');
 assert.equal(allowanceLimit(value,{...input,base:'hosted',trials:[],service:'transactional_email'}),9223372036854775807n);
});

test('allowance months follow UTC calendar boundaries including leap and early years',async()=>{
 const {allowanceMonth}=await api();
 for(const [day,from,until] of [['2028-02-29','2028-02-01','2028-03-01'],['2027-02-28','2027-02-01','2027-03-01'],['2026-12-31','2026-12-01','2027-01-01'],['0001-01-31','0001-01-01','0001-02-01']] as const)assert.deepEqual(allowanceMonth(day),{from,until});
 for(const day of ['2027-02-29','2026-2-01','0000-01-01','2026-10-01\n','9999-12-31'])assert.throws(()=>allowanceMonth(day),{code:'invalid_allowance_input'});
});

test('an unpaid active trial tightens translation and solver without tightening basic services',async()=>{
 const {allowanceLimit}=await api();
 assert.equal(allowanceLimit(TEST_ALLOWANCES,input),2n);
 assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,service:'rota_solver'}),1n);
 for(const hasPaymentMethod of [false,true]){
  assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,hasPaymentMethod,service:'transactional_email'}),4n);
  assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,hasPaymentMethod,service:'address_lookup'}),4n);
  assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,hasPaymentMethod,service:'sms'}),0n);
 }
});

test('a current payment method selects the full trial allowance',async()=>{
 const {allowanceLimit}=await api();
 assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,hasPaymentMethod:true}),6n);
 assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,hasPaymentMethod:true,service:'rota_solver'}),4n);
});

test('trial grants include their start and exclude their end',async()=>{
 const {allowanceLimit}=await api();
 assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,day:'2026-10-30'}),0n);
 assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,day:'2026-10-31'}),2n);
 assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,day:'2026-11-30'}),0n);
 assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,day:'2026-12-01'}),0n);
 for(const state of ['converted','lapsed'])assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,trials:[{...trial,state}]}),0n);
});

test('paid levels keep full allowances without a payment method or active trial',async()=>{
 const {allowanceLimit}=await api();
 assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,base:'connected',trials:[]}),6n);
 assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,base:'hosted',trials:[]}),8n);
 assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,trials:[],service:'content_translation'}),0n);
});

test('highest effective trial level selects one allowance rather than summing levels',async()=>{
 const {allowanceLimit}=await api(),hosted={...trial,level:'hosted'};
 assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,trials:[trial,hosted],hasPaymentMethod:true}),8n);
 assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,trials:[hosted,trial],hasPaymentMethod:true}),8n);
 assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,trials:[hosted],hasPaymentMethod:false}),2n);
 assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,base:'hosted',hasPaymentMethod:true}),8n);
});

test('method changes and trial extension change only the applicable ceiling',async()=>{
 const {allowanceLimit}=await api();
 for(const hasPaymentMethod of [false,true,false])assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,hasPaymentMethod}),hasPaymentMethod?6n:2n);
 assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,day:'2026-12-15',trials:[{...trial,extended:true,endsOn:'2026-12-30'}]}),2n);
 assert.equal(allowanceLimit(TEST_ALLOWANCES,{...input,day:'2026-12-30',trials:[{...trial,extended:true,endsOn:'2026-12-30'}]}),0n);
 assert.deepEqual(TEST_ALLOWANCES.unpaidTrial,{content_translation:'2',rota_solver:'1'});
});

test('malformed scope and trial facts cannot manufacture an allowance',async()=>{
 const {allowanceLimit}=await api();
 const bad:unknown[]=[undefined,null,{...input,base:'paid'},{...input,service:'other'},{...input,day:'2026-02-30'},{...input,hasPaymentMethod:1},{...input,trials:null},{...input,accountId:'unexpected'}];
 for(const change of [{level:'registered'},{state:'unknown'},{extended:1},{startedOn:'2026-02-30'},{endsOn:trial.startedOn},{endsOn:'2026-10-30'},{extra:true}])bad.push({...input,trials:[{...trial,...change}]});
 bad.push({...input,trials:[trial,trial]});
 for(const value of bad)assert.throws(()=>allowanceLimit(TEST_ALLOWANCES,value),{code:'invalid_allowance_input'});
 assert.throws(()=>allowanceLimit({...TEST_ALLOWANCES,effectiveFrom:'2026-12-01'},input),{code:'allowance_unavailable'});
});
