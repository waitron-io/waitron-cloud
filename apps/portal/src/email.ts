// Keep browser validation aligned with normaliseEmail without bundling server code.
export function validEmail(value:string):boolean {
  if(value.length>254)return false;
  const parts=value.trim().toLowerCase().split('@');
  const local=parts[0]??'',domain=parts[1]??'',labels=domain.split('.');
  return parts.length===2&&local.length<=64
    &&/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)
    &&labels.length>=2&&labels.every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
