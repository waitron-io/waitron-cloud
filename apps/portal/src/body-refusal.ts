import type {ApiResult} from './api.ts';

export function bodyRefusal(result: Extract<ApiResult<unknown>, {ok: false}>): 'Interrupted' | 'Size' | 'Format' | undefined {
  if (result.code !== 'invalid_input') return undefined;
  if (result.status === 408) return 'Interrupted';
  if (result.status === 413) return 'Size';
  if (result.status === 415) return 'Format';
  return undefined;
}
