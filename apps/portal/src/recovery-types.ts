export interface ReplacementView {
 requestId:string;pointId:string;venueId:string;oldInstallationId:string;localVenueId:string;nodeId:string;
 environment:'test';publicKey:string;peerPublicKey:string;state:'awaiting_owner'|'complete';expiresAt:string;
 organisationName:string;legalBusinessName:string;
 registration:null|{venueId:string;installationId:string;organisationId:string;legalBusinessId:string};
}
export interface RecoveryView {
 requestId:string;state:'awaiting_owner'|'approved';expiresAt:string;operationId:string|null;
 operation:null|{id:string;venueId:string;pointId:string;mode:'failure';status:'pending'|'restored'|'closed';expiresAt:string};
 replacement?:ReplacementView|null;
}
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const keys=['requestId','pointId','venueId','oldInstallationId','localVenueId','nodeId','environment','publicKey','peerPublicKey','state','expiresAt','organisationName','legalBusinessName','registration'];
const canonicalBase64=(v:unknown,length:number,url:boolean)=>{
 if(typeof v!=='string'||!(url?/^[A-Za-z0-9_-]+$/:/^[A-Za-z0-9+/]+={0,2}$/).test(v))return false;
 try{const bytes=Uint8Array.from(atob(url?v.replace(/-/g,'+').replace(/_/g,'/'):v),c=>c.charCodeAt(0));
  if(bytes.length!==length)return false;
  const encoded=btoa(String.fromCharCode(...bytes));return (url?encoded.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''):encoded)===v;
 }catch{return false;}
};
function validReplacement(value:unknown,requestId:string,op:NonNullable<RecoveryView['operation']>):value is ReplacementView{
 if(!value||typeof value!=='object')return false;
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==keys.length||keys.some(k=>!(k in v)))return false;
 if(v.requestId!==requestId||v.pointId!==op.pointId||v.venueId!==op.venueId||!uuid(v.oldInstallationId)||!uuid(v.localVenueId)||!uuid(v.nodeId)||v.environment!=='test'||!date(v.expiresAt)||typeof v.organisationName!=='string'||!v.organisationName.trim()||typeof v.legalBusinessName!=='string'||!v.legalBusinessName.trim())return false;
 if(!canonicalBase64(v.publicKey,44,true)||!canonicalBase64(v.peerPublicKey,32,false))return false;
 const der=atob((v.publicKey as string).replace(/-/g,'+').replace(/_/g,'/'));
 if(der.slice(0,12)!=='0*\x30\x05\x06\x03+ep\x03!\x00')return false;
 if(v.state==='awaiting_owner')return op.status==='restored'&&v.registration===null;
 if(v.state!=='complete'||!v.registration||typeof v.registration!=='object')return false;
 const reg=v.registration as Record<string,unknown>;
 return Object.keys(reg).length===4&&reg.venueId===v.venueId&&uuid(reg.installationId)&&uuid(reg.organisationId)&&uuid(reg.legalBusinessId);
}
export function validRecoveryView(value:unknown):value is RecoveryView {
 if(!value||typeof value!=='object')return false;const v=value as Record<string,unknown>;
 if(!uuid(v.requestId)||!date(v.expiresAt))return false;
 if(v.state==='awaiting_owner')return v.operationId===null&&v.operation===null&&(v.replacement===undefined||v.replacement===null);
 if(v.state!=='approved'||v.operationId!==v.requestId||!v.operation||typeof v.operation!=='object')return false;
 const op=v.operation as Record<string,unknown>;
 if(op.id!==v.requestId||!uuid(op.venueId)||!uuid(op.pointId)||op.mode!=='failure'||!['pending','restored','closed'].includes(String(op.status))||!date(op.expiresAt))return false;
 return v.replacement===undefined||v.replacement===null||validReplacement(v.replacement,v.requestId as string,op as NonNullable<RecoveryView['operation']>);
}
