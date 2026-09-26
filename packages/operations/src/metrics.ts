import type {OperationsSnapshot} from './status.ts';

const componentNames={controlApi:'control_api',monitoring:'monitoring',email:'email',backups:'backups',remoteConfiguration:'remote_configuration',gateways:'gateways',storage:'storage',usage:'usage'} as const;
function metric(lines:string[],name:string,help:string,value:number,labels?:Record<string,string>){
 lines.push(`# HELP ${name} ${help}`,`# TYPE ${name} gauge`,`${name}${labels?`{${Object.entries(labels).map(([key,item])=>`${key}="${item}"`).join(',')}}`:''} ${value}`);
}
function family(lines:string[],name:string,help:string,values:Record<string,number>){
 lines.push(`# HELP ${name} ${help}`,`# TYPE ${name} gauge`);
 for(const [status,value] of Object.entries(values))lines.push(`${name}{status="${status}"} ${value}`);
}
export function operationsMetrics(snapshot:OperationsSnapshot){
 const lines:string[]=[];
 metric(lines,'waitron_cloud_operations_ready','Whether every required Cloud operations check is ready.',snapshot.ready?1:0);
 lines.push('# HELP waitron_cloud_operations_component_info Current state and stable diagnostic code for each component.','# TYPE waitron_cloud_operations_component_info gauge');
 for(const [name,component] of Object.entries(snapshot.components))lines.push(`waitron_cloud_operations_component_info{component="${componentNames[name as keyof typeof componentNames]}",state="${component.state}",code="${component.code}"} 1`);
 metric(lines,'waitron_cloud_operations_control_api_elapsed_milliseconds','Slowest control API health probe duration.',snapshot.components.controlApi.elapsedMs??0);
 family(lines,'waitron_cloud_operations_monitoring_targets','Monitoring targets by current condition',{configured:snapshot.components.monitoring.venues,due:snapshot.components.monitoring.due,unknown:snapshot.components.monitoring.unknown,incidents:snapshot.components.monitoring.incidents});
 family(lines,'waitron_cloud_operations_email_messages','Administrative email rows by status',Object.fromEntries(Object.entries(snapshot.components.email.counts).map(([key,value])=>[key,value??0])));
 metric(lines,'waitron_cloud_operations_email_backlogged','Administrative email rows beyond the current delivery bound.',snapshot.components.email.backlogged);
 family(lines,'waitron_cloud_operations_backup_jobs','Backup worker jobs by status',Object.fromEntries(Object.entries(snapshot.components.backups.counts).map(([key,value])=>[key,value??0])));
 metric(lines,'waitron_cloud_operations_backup_jobs_due','Backup worker jobs currently due.',snapshot.components.backups.due);
 family(lines,'waitron_cloud_operations_remote_configuration_jobs','Remote configuration jobs by current condition',{enabled:snapshot.components.remoteConfiguration.enabled,due:snapshot.components.remoteConfiguration.due,running:snapshot.components.remoteConfiguration.running,failed:snapshot.components.remoteConfiguration.failed});
 family(lines,'waitron_cloud_operations_gateway_checks','Current gateway checks by evidence condition',{expected:snapshot.components.gateways.expected,healthy:snapshot.components.gateways.healthy,failed:snapshot.components.gateways.failed,stale:snapshot.components.gateways.stale,missing:snapshot.components.gateways.missing});
 family(lines,'waitron_cloud_operations_storage_checks','Current snapshot checks by evidence condition',{expected:snapshot.components.storage.expected,healthy:snapshot.components.storage.healthy,pending:snapshot.components.storage.pending,failed:snapshot.components.storage.failed,stale:snapshot.components.storage.stale,missing:snapshot.components.storage.missing});
 family(lines,'waitron_cloud_operations_usage_sources','Usage reconciliation sources by evidence condition',{configured:snapshot.components.usage.sources,stale:snapshot.components.usage.stale,unknown:snapshot.components.usage.unknown});
 return lines.join('\n')+'\n';
}
