export type CivilDate = string;
export type PaymentMethodKind = 'card' | 'direct_debit';
export type PaidLevel = 'connected' | 'hosted';
export type FailureTimeline = {retryDates:CivilDate[];servicesStop:CivilDate};

export const ATTEMPT_LEAD_DAYS = {card:7,direct_debit:10} as const;
export const HOSTED_GRACE_DAYS = 30;
export const DIRECT_DEBIT_RETRY_SPACING_DAYS = 14;

export function addDays(date:CivilDate,days:number):CivilDate {
  const value=new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate()+days);
  return value.toISOString().slice(0,10);
}

export function renewalDateIn(anchorDay:number,year:number,month:number):CivilDate {
  const last=new Date(Date.UTC(year,month,0)).getUTCDate();
  return new Date(Date.UTC(year,month-1,Math.min(anchorDay,last))).toISOString().slice(0,10);
}

export function renewalOnOrAfter(anchorDay:number,date:CivilDate):CivilDate {
  const value=new Date(`${date}T00:00:00Z`);
  const year=value.getUTCFullYear(),month=value.getUTCMonth()+1;
  const renewal=renewalDateIn(anchorDay,year,month);
  return renewal>=date?renewal:renewalDateIn(anchorDay,month===12?year+1:year,month===12?1:month+1);
}

export function nextRenewalAfter(anchorDay:number,date:CivilDate):CivilDate {
  return renewalOnOrAfter(anchorDay,addDays(date,1));
}

export function firstAttemptDate(renewal:CivilDate,method:PaymentMethodKind,today:CivilDate):CivilDate {
  const attempt=addDays(renewal,-ATTEMPT_LEAD_DAYS[method]);
  return attempt<today?today:attempt;
}

export function firstChargedRenewal(anchorDay:number|null,chargeableFrom:CivilDate,method:PaymentMethodKind):CivilDate {
  return anchorDay===null?chargeableFrom:renewalOnOrAfter(anchorDay,addDays(chargeableFrom,ATTEMPT_LEAD_DAYS[method]));
}

export function failureTimeline(level:PaidLevel,method:PaymentMethodKind,renewal:CivilDate,firstFailure:CivilDate):FailureTimeline {
  if(level==='connected') {
    const retryDates=method==='card'?[addDays(renewal,-4),addDays(renewal,-1)].filter(date=>date>firstFailure):[];
    return {retryDates,servicesStop:renewal};
  }
  const servicesStop=addDays(renewal,HOSTED_GRACE_DAYS);
  const spacing=method==='card'?7:DIRECT_DEBIT_RETRY_SPACING_DAYS;
  const lastRetry=addDays(servicesStop,method==='card'?-1:-ATTEMPT_LEAD_DAYS.direct_debit);
  const retryDates:CivilDate[]=[];
  for(let retry=addDays(firstFailure,spacing);retry<=lastRetry;retry=addDays(retry,spacing)) retryDates.push(retry);
  return {retryDates,servicesStop};
}

export function refundTimeline(level:PaidLevel,method:PaymentMethodKind,learnedOn:CivilDate):FailureTimeline {
  return failureTimeline(level,method,addDays(learnedOn,7),learnedOn);
}
