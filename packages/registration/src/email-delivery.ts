import type {HandoffAdmission} from './mail-attempts.ts';
import type {SesProviderReceipt} from './ses-smtp-metadata.ts';
export interface EmailDeliveryContext { deliveryId: string; signal: AbortSignal; ses?:HandoffAdmission; }
export interface EmailDeliveryReceipt { transport: 'smtp'; messageId: string; providerReceipt?:SesProviderReceipt; }
export type EmailDeliveryFailure = 'delivery_failed' | 'delivery_timeout' | 'delivery_deferred' | 'delivery_rejected' | 'delivery_configuration';
export class EmailDeliveryError extends Error {
  readonly code: EmailDeliveryFailure;
  readonly retryable: boolean;
  constructor(code: EmailDeliveryFailure) {
    super(code); this.name = 'EmailDeliveryError'; this.code = code;
    this.retryable = code !== 'delivery_rejected';
  }
}
