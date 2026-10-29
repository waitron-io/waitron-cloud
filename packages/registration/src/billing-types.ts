import type {PoolClient} from 'pg';
import type {CivilDate,PaidLevel,PaymentMethodKind} from './billing-calendar.ts';
import type {PriceList,RenewalLine,ChargeTotals} from './billing-charges.ts';

export type BillingScope={organisationId:string;legalBusinessId:string};
export type BillingLevel='registered'|PaidLevel;
export type BillingProvider='sumup'|'stripe';
export type PaymentState='pending'|'succeeded'|'failed'|'refunded';
export type BillingPriceVersion={revision:number;effectiveFrom:CivilDate;currency:'EUR';prices:PriceList;vatRateBasisPoints:number};
export type ProviderMethod={id:string;kind:PaymentMethodKind;provider:BillingProvider;providerAccountId:string;customerId:string;methodId:string;mandateId:string|null};
export type BusinessBillingView=BillingScope&{anchorDay:number|null;anchorDate:CivilDate|null;revision:number;paymentMethod:ProviderMethod|null};
export type VenueBillingView=BillingScope&{venueId:string;revision:number;level:BillingLevel;connectedFrom:CivilDate|null;lapsedOn:CivilDate|null;scheduledLevel:'registered'|'connected'|null;scheduledOn:CivilDate|null};
export type TrialView={level:PaidLevel;startedOn:CivilDate;endsOn:CivilDate;extended:boolean;state:'active'|'converted'|'lapsed'};
export type PaidPeriod={level:PaidLevel;chargeId:string;attemptId:string;from:CivilDate;until:CivilDate};
export type VenueBillingHistory={trials:TrialView[];paid:PaidPeriod[]};
export type BillingEvent={key:string;occurredAt:string;source:{kind:'internal'}|{kind:'provider';provider:BillingProvider;accountId:string}};
export type HostedWindow={from:CivilDate;through:CivilDate};
export type FrozenCharge=BillingScope&{id:string;kind:'renewal'|'hosted_comeback';renewalDate:CivilDate;connectedUntil:CivilDate|null;window:HostedWindow;price:BillingPriceVersion;lines:RenewalLine[];totals:ChargeTotals};
export type PaymentObservation={eventId:string;state:PaymentState;occurredAt:string};
export type PaymentView={attemptId:string;chargeId:string;method:ProviderMethod;requestKey:string;providerPaymentId:string|null;state:PaymentState;revision:number;succeededAt:string|null;observations:PaymentObservation[]};
export type BillingCommand=
 |{type:'ensure_business'}
 |{type:'set_method';method:ProviderMethod|null}
 |{type:'anchor';on:CivilDate;mode:'initial'|'comeback';expectedRevision:number}
 |{type:'set_venue';venueId:string;expectedRevision:number;value:Pick<VenueBillingView,'level'|'connectedFrom'|'lapsedOn'|'scheduledLevel'|'scheduledOn'>}
 |{type:'start_trial';venueId:string;level:PaidLevel;on:CivilDate}
 |{type:'extend_trial';venueId:string;level:'connected';expectedEnd:CivilDate}
 |{type:'end_trial';venueId:string;level:PaidLevel;expectedEnd:CivilDate;outcome:'converted'|'lapsed'}
 |{type:'hosted_day';venueId:string;on:CivilDate;coveredByChargeId:string|null}
 |{type:'freeze_charge';chargeId:string;kind:'renewal'|'hosted_comeback';renewalDate:CivilDate;connectedUntil:CivilDate|null;window:HostedWindow;priceRevision:number}
 |{type:'begin_attempt';chargeId:string;attemptId:string;methodId:string;requestKey:string}
 |{type:'observe_payment';attemptId:string;providerPaymentId:string;state:PaymentState;expectedRevision:number|null};
export type BillingValue=BusinessBillingView|VenueBillingView|TrialView|FrozenCharge|PaymentView|{venueId:string;on:CivilDate;coveredByChargeId:string|null};
export type BillingReceipt={eventId:string;value:BillingValue};
export type BillingErrorCode='invalid_billing_input'|'billing_scope_not_found'|'billing_event_conflict'|'billing_state_conflict'|'billing_price_unavailable'|'billing_price_conflict'|'billing_charge_conflict'|'billing_trial_unavailable';
export class BillingError extends Error{
 readonly code:BillingErrorCode;
 constructor(code:BillingErrorCode){super(code);this.name='BillingError';this.code=code;}
}
export type BillingContext={client:PoolClient;scope:BillingScope;eventId:string;occurredAt:string};
