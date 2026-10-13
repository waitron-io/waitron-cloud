import type {MonitorConfig} from './monitoring.ts';

function bounded(value:number,min:number,max:number){
 if(!Number.isInteger(value)||value<min||value>max)throw new Error('invalid_monitor_config');
 return value;
}
export function validatedMonitorConfig(config:MonitorConfig={}){
 return {quietSeconds:bounded(config.quietSeconds??0,0,604800),reminderSeconds:bounded(config.reminderSeconds??0,0,604800),
  probeStaleSeconds:bounded(config.probeStaleSeconds??300,1,86400),certificateWarningDays:bounded(config.certificateWarningDays??30,1,3650)};
}
export function monitorConfigFromEnv(env:NodeJS.ProcessEnv):MonitorConfig{
 function value(name:string){const raw=env[name];if(raw===undefined)return undefined;if(raw.trim()==='')throw new Error('invalid_monitor_config');return Number(raw);}
 return validatedMonitorConfig({quietSeconds:value('CLOUD_MONITOR_QUIET_SECONDS'),reminderSeconds:value('CLOUD_MONITOR_REMINDER_SECONDS'),
  probeStaleSeconds:value('CLOUD_REMOTE_PROBE_STALE_SECONDS'),certificateWarningDays:value('CLOUD_REMOTE_CERTIFICATE_WARNING_DAYS')});
}
