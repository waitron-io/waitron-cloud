export function matchGuestMenuLanguage(preferences:readonly string[],offered:readonly string[]):string|undefined{
 const canonical=(tag:string):string|undefined=>{
  try{return new Intl.Locale(tag).baseName;}catch{return undefined;}
 };
 const choices=offered.map(tag=>({tag,canonical:canonical(tag)}));
 for(const preference of preferences){
  const tag=canonical(preference);if(!tag)continue;
  let parent=tag;
  while(parent){
   const exact=choices.find(choice=>choice.canonical===parent);
   if(exact)return exact.tag;
   const end=parent.lastIndexOf('-');parent=end<0?'':parent.slice(0,end);
  }
  const base=tag.split('-')[0],related=choices.find(choice=>choice.canonical?.split('-')[0]===base);
  if(related)return related.tag;
 }
 return undefined;
}
