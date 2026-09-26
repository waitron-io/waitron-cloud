export interface UsageSummary{
 version:1;organisationId:string;
 storage:{currentBytes:string;addedBytes:string;removedBytes:string};
 transfer:{uploadedBytes:string;restoredBytes:string};
 operations:{installationCompleted:string;monitoringProbes:string};
 messages:{sent:string;failed:string;expired:string;cancelled:string};
 latestEventAt:string|null;measuredThrough:string|null;
}

const decimal=/^(?:0|[1-9][0-9]*)$/;
const signedDecimal=/^-?(?:0|[1-9][0-9]*)$/;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const timestamp=(value:unknown)=>value===null||(typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value);
export function validUsageSummary(value:unknown):value is UsageSummary{
 if(!object(value)||!exact(value,['version','organisationId','storage','transfer','operations','messages','latestEventAt','measuredThrough'])||value.version!==1||typeof value.organisationId!=='string'||!uuid.test(value.organisationId)||!timestamp(value.latestEventAt)||!timestamp(value.measuredThrough))return false;
 const groups=[
  [value.storage,['currentBytes','addedBytes','removedBytes']],
  [value.transfer,['uploadedBytes','restoredBytes']],
  [value.operations,['installationCompleted','monitoringProbes']],
  [value.messages,['sent','failed','expired','cancelled']],
 ] as const;
 return groups.every(([group,keys],index)=>object(group)&&exact(group,[...keys])&&keys.every(key=>typeof group[key]==='string'&&(index===0&&key==='currentBytes'?signedDecimal:decimal).test(group[key] as string)));
}
