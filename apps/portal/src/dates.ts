import type {Locale} from './locale.ts';

export function formatDateTime(value: string, locale: Locale): string {
 return new Date(value).toLocaleString(locale, {dateStyle: 'long', timeStyle: 'medium'});
}
