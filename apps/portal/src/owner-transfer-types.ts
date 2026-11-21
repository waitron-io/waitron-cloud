export interface OwnerTransfer {id:string;organisationId:string;organisationName:string;businessNames?:string[];senderEmail:string;recipientEmail:string;expiresAt:string;state:'pending'|'accepted'|'cancelled'|'expired';incoming:boolean}
export interface OwnerTransferList {organisations:{id:string;name:string}[];offers:OwnerTransfer[]}
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
export function validOwnerTransfer(value:unknown):value is OwnerTransfer {
 if(!value||typeof value!=='object')return false;const row=value as Record<string,unknown>;
 return uuid(row.id)&&uuid(row.organisationId)&&['organisationName','senderEmail','recipientEmail'].every(k=>typeof row[k]==='string')
  &&(row.businessNames===undefined||Array.isArray(row.businessNames)&&row.businessNames.every(name=>typeof name==='string'))
  &&typeof row.incoming==='boolean'&&typeof row.expiresAt==='string'&&Number.isFinite(Date.parse(row.expiresAt))&&['pending','accepted','cancelled','expired'].includes(String(row.state));
}
export function validOwnerTransferList(value:unknown):value is OwnerTransferList {
 if(!value||typeof value!=='object')return false;const row=value as Record<string,unknown>;
 return Array.isArray(row.offers)&&row.offers.length<=100&&row.offers.every(validOwnerTransfer)&&Array.isArray(row.organisations)&&row.organisations.every(o=>o&&uuid(o.id)&&typeof o.name==='string');
}
