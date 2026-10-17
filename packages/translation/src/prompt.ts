import type {JobItem,ParsedJob} from './job-body.ts';
import type {ItemResult} from './job-store.ts';
const languages=new Intl.DisplayNames(['en'],{type:'language'}),regions=new Intl.DisplayNames(['en'],{type:'region'});
const named=(code:string)=>`${languages.of(code)} (${code})`;
function ordered(job:ParsedJob){return [job.languages.default,...job.languages.enabled.filter(l=>l!==job.languages.default)];}
function joined(parts:string[]){return parts.length<2?parts.join(''):`${parts.slice(0,-1).join(', ')} and ${parts.at(-1)}`;}
export function batchIds(batch:readonly JobItem[]){const width=Math.max(2,String(batch.length).length);return batch.map((_,i)=>'p'+String(i+1).padStart(width,'0'));}
export function firstPassInstructions(job:ParsedJob){
 const [first,...rest]=ordered(job);
 const otherLine=!rest.length?'The venue has no other customer languages.':rest.length===1?`The other customer language is ${named(rest[0]!)}.`:`The other customer languages are ${joined(rest.map(named))}.`;
 const shape=[first!,...rest].map(l=>`"${l}": "..."`).join(', ');
 return `You write customer-facing names for a venue's menu in ${regions.of(job.country)}.
The venue's default customer language is ${named(first!)}. ${otherLine}

Each product has an internal name typed quickly by staff: often in capitals, mixing languages, with typos,
abbreviations, prices or codes. Some products already have a customer-facing name in one or more languages.

Rules:
1. A customer-facing name that is already given is kept exactly as given, character for character.
2. A dish or drink that has a standard name in a language is called by that name in that language, the way a local
   menu would print it, not translated word for word from another language. For example patates braves (ca) /
   patatas bravas (es) / patatas bravas (en); truita de patates (ca) / tortilla de patatas (es) / Spanish omelette
   (en). Keep any detail the existing names add beyond the standard dish: "patatas bravas con alioli" becomes
   "patates braves amb allioli".
   Some names stay as they are on menus here in every language, such as a sandwich or bowl known by an English or
   brand-like name (brunch, poke bowl); do not translate those.
3. Otherwise, write a missing language from the existing customer-facing names (given, or written by you for the
   default language), never from the internal name alone when a customer-facing name exists.
4. Write each language as a native speaker would. Each language's names use that language's own vocabulary, not another
   language's words written in its spelling.
5. Correct typos in dish names and in brand names, and spell a brand as the brand spells it.
6. Keep everything the customer needs to know: what comes with it (with fries, with salad), the serving size
   (33 cl, 50 cl, half, double), and whether it is takeaway. Correct an obviously wrong unit (a 33 ml bottle is
   33 cl). Drop only prices, stock codes and staff notes. Use sentence case.
7. Never change a customer-facing name that is already given, even to fix it. If it has a spelling mistake, list
   the fix under "corrections" with "field" set to its language.
8. When you correct a typo in the internal name (in a dish or a brand), list it under "corrections" with "field" set
   to "internal", so staff can fix the internal name too. List only real spelling fixes, not translations,
   capitalisation or dropped prices.
9. A placeholder product is one whose internal name does not say what the customer gets, such as a "special" sold
   at a price (SPECIAL 7, TAPA SPECIAL 3.00). Do not invent a name for it: set "placeholder": true and leave all
   its names empty.

Reply with JSON only, no prose, in exactly this shape:
{"products": [{"id": "p01", ${shape}, "placeholder": false,
  "corrections": [{"field": "internal", "wrong": "...", "right": "..."}]}]}
"corrections" is an empty list when there is nothing to fix.
Every product appears once.`;
}
export function firstPassInput(job:ParsedJob,batch:readonly JobItem[]){
 const ids=batchIds(batch),idOf=new Map(batch.map((item,i)=>[item.ref,ids[i]!]));
 const rows=batch.map((item,i)=>{
  const head=item.family!==item.ref?idOf.get(item.family):undefined;
  return {id:ids[i]!,kind:item.kind,internal:item.staffName,category:item.category,existing:item.existing,...(head?{partOf:head}:{})};
 });
 const style=job.houseStyle.length
  ?'Names this venue has saved: follow their wording where they apply.\n'+JSON.stringify(job.houseStyle.map(h=>({kind:h.kind,internal:h.staffName,names:h.names})),null,1)+'\n\n':'';
 return style+'Products:\n'+JSON.stringify(rows,null,1);
}
export function reviewInstructions(job:ParsedJob){
 const list=ordered(job).map(l=>`${l} (${languages.of(l)}${l===job.languages.default?', the default':''})`).join(', ');
 return `You review customer-facing names that someone else wrote for a venue's menu.
The venue's customer languages are: ${list}.

For every name in every language, ask: is this exactly how a native speaker writing this venue's menu in that
language would print it? Check that it uses that language's own vocabulary and grammar, the standard local name of
the dish or drink where one exists, no word-for-word copy of another language's phrasing, and that nothing the
customer needs (what comes with it, the serving size, takeaway) has been lost compared with the internal name and
the other languages.

Names marked "given" were entered by the venue and are never changed. Leave a name alone when it is already right.

Reply with JSON only, no prose, listing only the names you would change:
{"changes": [{"id": "p01", "language": "ca", "name": "...", "reason": "..."}]}
"changes" is an empty list when every name is right. Write reasons in English.`;
}
export function reviewInput(job:ParsedJob,batch:readonly JobItem[],first:readonly ItemResult[]){
 const ids=batchIds(batch),byRef=new Map(first.map(r=>[r.ref,r])),order=ordered(job);
 const rows=batch.flatMap((item,i)=>{
  const result=byRef.get(item.ref);
  if(!item.missing.length||!result||result.placeholder)return [];
  return [{id:ids[i]!,internal:item.staffName,category:item.category,
   names:Object.fromEntries(order.map(l=>[l,item.existing[l]??result.names[l]??''])),given:Object.keys(item.existing).sort()}];
 });
 return rows.length?'Names:\n'+JSON.stringify(rows,null,1):undefined;
}
