export type TranslationErrorCode='invalid_request'|'consent_required'|'job_not_found'|'job_running'|'limit_reached'|'not_ready'|'expired'|'job_too_large'|'conflict'|'forbidden';
export class TranslationError extends Error {
  readonly code:TranslationErrorCode;
  readonly fits:number|undefined;
  constructor(code:TranslationErrorCode,fits?:number){
    super(code);this.name='TranslationError';this.code=code;this.fits=fits;
  }
}
