import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MonitorWorker} from '../src/monitoring.ts';
import type {Pool} from 'pg';
import type {EmailOutbox} from '../src/email-outbox.ts';

// Removing input bounds would admit a schedule that cannot be persisted or observed.
for(const field of ['quietSeconds','reminderSeconds'] as const){
 test(field+' accepts bounded whole seconds and rejects invalid direct options',()=>{
  for(const value of [undefined,0,1,604800])assert.doesNotThrow(()=>new MonitorWorker({} as Pool,{} as EmailOutbox,{[field]:value}));
  for(const value of [-1,1.5,NaN,Infinity,604801])assert.throws(()=>new MonitorWorker({} as Pool,{} as EmailOutbox,{[field]:value}),/invalid_monitor_config/);
 });
}
test('environment configuration defaults off and rejects blank or invalid settings',async()=>{
 const module=await import('../src/monitor-config.ts').catch(()=>null);
 assert.equal(typeof module?.monitorConfigFromEnv,'function','environment timing parser exists');
 const parse=module!.monitorConfigFromEnv;
 assert.deepEqual(parse({}),{quietSeconds:0,reminderSeconds:0,probeStaleSeconds:300,certificateWarningDays:30});
 for(const name of ['CLOUD_MONITOR_QUIET_SECONDS','CLOUD_MONITOR_REMINDER_SECONDS']){
  for(const value of ['0','1','604800'])assert.equal(parse({[name]:value})[name.includes('QUIET')?'quietSeconds':'reminderSeconds'],Number(value));
  for(const value of ['', ' ', '-1','1.5','NaN','Infinity','604801'])assert.throws(()=>parse({[name]:value}),/invalid_monitor_config/);
 }
 for(const name of ['CLOUD_REMOTE_PROBE_STALE_SECONDS','CLOUD_REMOTE_CERTIFICATE_WARNING_DAYS']){
  for(const value of ['', ' ', '0','-1','1.5','NaN','Infinity','999999'])assert.throws(()=>parse({[name]:value}),/invalid_monitor_config/);
 }
 assert.deepEqual(parse({CLOUD_REMOTE_PROBE_STALE_SECONDS:'86400',CLOUD_REMOTE_CERTIFICATE_WARNING_DAYS:'3650'}),{quietSeconds:0,reminderSeconds:0,probeStaleSeconds:86400,certificateWarningDays:3650});
});
