// Only fixed accounting labels may cross the anonymous result boundary.
const gapCodes = new Set([
  'litestream:requests-unreconciled', 'litestream:body-bytes-unpaired', 'litestream:object-lifetimes-unpaired',
  'after-stop:list-response-interrupted', 'after-stop:put-response-interrupted', 'after-stop:body-bytes-unpaired',
  'accounting:unreconciled', 'request-billing:unknown', 'accounting:request-cutoff',
  'accounting:meter-disagreement', 'accounting:incomplete-total', 'accounting:incomplete-history', 'accounting:overflow',
]);

export const isAccountingGap = code => typeof code === 'string' && gapCodes.has(code);
