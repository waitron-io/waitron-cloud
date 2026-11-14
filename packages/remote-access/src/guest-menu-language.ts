export function isGuestMenuLanguageShape(value:unknown):value is string{
 return typeof value==='string'&&(value==='ca-ES-valencia'||/^[a-z]{2,3}$/.test(value));
}
export function isGuestMenuLanguage(value:unknown):value is string{
 if(!isGuestMenuLanguageShape(value))return false;
 if(value==='ca-ES-valencia')return true;
 return !['und','mul','zxx'].includes(value)&&new Intl.Locale(value).language===value
  &&new Intl.DisplayNames(['en'],{type:'language',fallback:'none'}).of(value)!==undefined;
}
