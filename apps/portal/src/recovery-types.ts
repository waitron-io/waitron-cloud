export interface RecoveryView {
 requestId:string;state:'awaiting_owner'|'approved';expiresAt:string;operationId:string|null;
 operation:null|{id:string;venueId:string;pointId:string;mode:'failure';status:'pending'|'restored'|'closed';expiresAt:string};
}
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function validRecoveryView(value:unknown):value is RecoveryView {
 if(!value||typeof value!=='object')return false;const v=value as Record<string,unknown>;
 if(!uuid(v.requestId)||!date(v.expiresAt))return false;
 if(v.state==='awaiting_owner')return v.operationId===null&&v.operation===null;
 if(v.state!=='approved'||v.operationId!==v.requestId||!v.operation||typeof v.operation!=='object')return false;
 const op=v.operation as Record<string,unknown>;return op.id===v.requestId&&uuid(op.venueId)&&uuid(op.pointId)&&op.mode==='failure'&&['pending','restored','closed'].includes(String(op.status))&&date(op.expiresAt);
}
