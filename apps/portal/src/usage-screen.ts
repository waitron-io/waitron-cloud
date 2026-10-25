import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
import type {Locale} from './locale.ts';
import {formatDateTime} from './dates.ts';

const maximumSafe=BigInt(Number.MAX_SAFE_INTEGER),units=['bytes','KiB','MiB','GiB','TiB'] as const;
export function formatCount(decimal:string,locale:Locale){return new Intl.NumberFormat(locale).format(BigInt(decimal));}
export function formatBytes(decimal:string,locale:Locale,byteLabel:string,singularByteLabel='byte'){
 const value=BigInt(decimal),absolute=value<0n?-value:value,number=new Intl.NumberFormat(locale);
 if(absolute>maximumSafe)return `${number.format(value)} ${byteLabel}`;
 let divisor=1n,unit=0;
 // Choose the unit after rounding to tenths so a boundary displays 1 of the next unit.
 while(unit<units.length-1&&(absolute*10n+divisor/2n)/divisor>=10240n){divisor*=1024n;unit++;}
 if(unit===0)return `${number.format(value)} ${new Intl.PluralRules(locale).select(Number(value))==='one'?singularByteLabel:byteLabel}`;
 const sign=value<0n?'-':'',whole=absolute/divisor,tenth=((absolute%divisor)*10n+divisor/2n)/divisor;
 const rounded=tenth===10n?whole+1n:whole,digit=tenth===10n?0n:tenth;
 const decimalMark=new Intl.NumberFormat(locale).formatToParts(1.1).find(part=>part.type==='decimal')?.value??'.';
 return `${sign}${number.format(rounded)}${digit?decimalMark+digit.toString():''} ${units[unit]}`;
}

export function usageScreen(app:PortalApp){
 const usage=app.usage,c=app.copy,summary=usage.summary,disabled=usage.pending||!!usage.waiting;
 if(!usage.organisationId)return nothing;
 const bytes=(value:string)=>formatBytes(value,app.locale,c.usageBytes,c.usageByte);
 const count=(value:string)=>formatCount(value,app.locale);
 const refresh=()=>{usage.refresh();void usage.load();};
 return html`<section class="usage" aria-label=${c.usageTitle}><h3>${c.usageTitle}</h3><p>${c.usageIntro}</p>
  ${usage.error?html`<p role="alert">${c[usage.error]}</p>`:nothing}
  ${!summary?(usage.error?nothing:html`<p role="status">${usage.pending?c.wait:c.usageUnavailable}</p>`):html`
   ${summary.measuredThrough?html`<p>${c.usageMeasuredThrough}: <time datetime=${summary.measuredThrough}>${formatDateTime(summary.measuredThrough,app.locale)}</time>. ${c.usageMayLag}</p>`:html`<p role="status">${c.usagePending}</p>`}
   ${summary.latestEventAt?html`<p>${c.usageLatestEvent}: <time datetime=${summary.latestEventAt}>${formatDateTime(summary.latestEventAt,app.locale)}</time></p>`:html`<p>${c.usageNoEvents}</p>`}
   <div class="usage-groups">
    <section aria-label=${c.usageStorage}><h4>${c.usageStorage}</h4><dl><dt>${c.usageStorageCurrent}</dt><dd>${bytes(summary.storage.currentBytes)}</dd><dt>${c.usageStorageAdded}</dt><dd>${bytes(summary.storage.addedBytes)}</dd><dt>${c.usageStorageRemoved}</dt><dd>${bytes(summary.storage.removedBytes)}</dd></dl></section>
    <section aria-label=${c.usageTransfer}><h4>${c.usageTransfer}</h4><dl><dt>${c.usageUploaded}</dt><dd>${bytes(summary.transfer.uploadedBytes)}</dd><dt>${c.usageRestored}</dt><dd>${bytes(summary.transfer.restoredBytes)}</dd></dl></section>
    <section aria-label=${c.usageOperations}><h4>${c.usageOperations}</h4><dl><dt>${c.usageInstallations}</dt><dd>${count(summary.operations.installationCompleted)}</dd><dt>${c.usageProbes}</dt><dd>${count(summary.operations.monitoringProbes)}</dd></dl></section>
    <section aria-label=${c.usageMessages}><h4>${c.usageMessages}</h4><dl><dt>${c.usageSent}</dt><dd>${count(summary.messages.sent)}</dd><dt>${c.usageFailed}</dt><dd>${count(summary.messages.failed)}</dd><dt>${c.usageExpired}</dt><dd>${count(summary.messages.expired)}</dd><dt>${c.usageCancelled}</dt><dd>${count(summary.messages.cancelled)}</dd></dl></section>
   </div><p class="help">${c.usageExclusions}</p><p class="help">${c.usageHistory}</p>`}
  <wt-button .disabled=${disabled} @click=${refresh}>${c.usageRefresh}</wt-button>
 </section>`;
}
