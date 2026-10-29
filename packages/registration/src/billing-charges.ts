import type {CivilDate} from './billing-calendar.ts';

export type PriceList = {connectedMonthlyCents:number;hostedMonthlyCents:number};
export type VenueChargeView = {venueId:string;connectedFrom:CivilDate|null;hostedDays:number;hostedDaysCoveredByConnected:number};
export type RenewalLine = {venueId:string;kind:'connected_month'|'hosted_days';quantity:number;cents:number};
export type ChargeTotals = {netCents:number;vatCents:number;grossCents:number};

export function hostedDaysCents(prices:PriceList,hostedDays:number,daysCoveredByConnected:number):number {
  const numerator=hostedDays*prices.hostedMonthlyCents-daysCoveredByConnected*prices.connectedMonthlyCents;
  return Math.max(0,Math.floor((numerator+15)/30));
}

export function renewalLines(renewal:CivilDate,prices:PriceList,venues:readonly VenueChargeView[]):RenewalLine[] {
  const lines:RenewalLine[]=[];
  for(const venue of [...venues].sort((a,b)=>a.venueId<b.venueId?-1:a.venueId>b.venueId?1:0)) {
    if(venue.connectedFrom!==null&&venue.connectedFrom<=renewal&&prices.connectedMonthlyCents>0) {
      lines.push({venueId:venue.venueId,kind:'connected_month',quantity:1,cents:prices.connectedMonthlyCents});
    }
    const cents=hostedDaysCents(prices,venue.hostedDays,venue.hostedDaysCoveredByConnected);
    if(cents>0) lines.push({venueId:venue.venueId,kind:'hosted_days',quantity:venue.hostedDays,cents});
  }
  return lines;
}

export function chargeTotals(lines:readonly RenewalLine[],vatRateBasisPoints:number):ChargeTotals {
  const netCents=lines.reduce((sum,line)=>sum+line.cents,0);
  const vatCents=Math.floor((netCents*vatRateBasisPoints+5000)/10000);
  return {netCents,vatCents,grossCents:netCents+vatCents};
}
