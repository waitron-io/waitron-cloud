import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
import {accountActionProofScreen} from './account-action-proof-screen.ts';

export function operatorVenuesScreen(app:PortalApp){
 const c=app.copy,controller=app.operatorVenues,{venue,results,error}=controller;
 const actions=app.cloudActions,disabled=controller.pending||!!controller.waiting;
 const path='/operator/venues';
 const find=html`<a href=${path} @click=${(event:MouseEvent)=>app.follow(event,path)}>${c.operatorFindVenue}</a>`;
 const back=html`<nav><a href="/operator/actions" @click=${(event:MouseEvent)=>app.follow(event,'/operator/actions')}>${c.cloudActionsTitle}</a></nav>`;
 if(app.session.state.kind==='unavailable')return html`<p>${c.sessionUnavailable}</p>
  <wt-button .disabled=${!!app.session.waiting} @click=${()=>{void app.session.check();}}>${c.retry}</wt-button>`;
 if(!actions.view?.operatorVenues)return html`
  ${actions.error?html`<p role="alert">${c[actions.error]}</p>
   <wt-button .disabled=${!!actions.waiting} @click=${()=>{void app.loadOperatorVenues();}}>${c.retry}</wt-button>`:
   html`<p>${actions.view?c.operatorVenueDemoOnly:c.checking}</p>`}${back}`;
 if(app.link.invalid)return html`<p role="alert">${c.linkUnavailable}</p>${find}`;
 const notice=error?html`<p role="alert">${c[error]}</p>`:nothing;
 if(app.link.operatorVenueId){
  const id=app.link.operatorVenueId;
  return html`${notice}${venue?html`
    <p role="status">${venue.stopped?c.operatorSuggestionsStopped:c.operatorSuggestionsAllowed}</p>
    <wt-button .disabled=${disabled||app.actionProof.pending} @click=${()=>{void app.setOperatorVenue(venue);}}>
     ${venue.stopped?c.operatorAllowSuggestions:c.operatorStopSuggestions}</wt-button>
    ${app.actionProof.loaded||app.actionProof.pending?accountActionProofScreen(app,2):nothing}`:
   controller.pending||!error?html`<wt-spinner .label=${c.checking}></wt-spinner>`:
    html`<wt-button .disabled=${disabled} @click=${()=>{void controller.read(id);}}>${c.retry}</wt-button>`}
   <nav>${find}</nav>`;
 }
 const search=(event:SubmitEvent)=>{
  event.preventDefault();
  const query=new FormData(event.currentTarget as HTMLFormElement).get('query');
  if(typeof query==='string')void controller.search(query);
 };
 const count=results?.venues.length??0;
 return html`<search><form id="operator-venue-search" class="business-choice" method="post" action="/api/account/operator/venues/read" @submit=${search}>
  <label for="operator-venue-query">${c.operatorVenueName}</label>
  <input type="search" id="operator-venue-query" name="query" minlength="3" maxlength="80" required autocomplete="off"
   aria-describedby="operator-venue-hint">
  <p class="help" id="operator-venue-hint">${c.operatorVenueSearchHint}</p>
  <button type="submit" class="text-button" ?disabled=${disabled}>${c.operatorVenueSearch}</button>
 </form></search>
 ${notice}<p role="status">${!results?'':results.tooMany?c.operatorVenueNarrow:count?
  c.operatorVenuesFound.replace('{count}',String(count)):c.operatorVenuesEmpty}</p>
 ${count?html`<ul>${results!.venues.map(row=>html`<li class="venue-id"><a href=${`${path}#venue=${row.id}&lang=${app.locale}`}
  @click=${(event:MouseEvent)=>app.openOperatorVenue(event,row)}>${row.name}
  ${results!.venues.filter(other=>other.name===row.name).length>1?html`<small>${row.id}</small>`:nothing}</a></li>`)}</ul>`:nothing}
 ${back}`;
}
