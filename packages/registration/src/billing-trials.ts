import {addDays,type CivilDate,type PaidLevel} from './billing-calendar.ts';

export const TRIAL_DAYS = 30;
export const TRIAL_EXTENSION_DAYS = 30;
export type TrialUsage = {remoteTrafficDays:number;translationRuns:number;solverRuns:number};
export type TrialOutcome = 'extend' | 'convert' | 'lapse';

export function trialEnd(start:CivilDate):CivilDate {
  return addDays(start,TRIAL_DAYS);
}

export function trialReminderDates(end:CivilDate):[CivilDate,CivilDate] {
  return [addDays(end,-7),addDays(end,-1)];
}

export function trialWasUsed(usage:TrialUsage):boolean {
  return usage.remoteTrafficDays>=3||usage.translationRuns>=1||usage.solverRuns>=1;
}

export function trialAllowanceTier(hasPaymentMethod:boolean):'trial'|'full' {
  return hasPaymentMethod?'full':'trial';
}

export function trialOutcome(input:{level:PaidLevel;hasPaymentMethod:boolean;usage:TrialUsage;alreadyExtended:boolean}):TrialOutcome {
  if(input.level==='connected'&&!trialWasUsed(input.usage)&&!input.alreadyExtended) return 'extend';
  return input.hasPaymentMethod?'convert':'lapse';
}

export function mayStartTrial(level:PaidLevel,history:{trialled:readonly PaidLevel[];paid:readonly PaidLevel[]}):boolean {
  return !history.trialled.includes(level)&&!history.paid.includes(level);
}
