export interface EmailDeliveryContext { deliveryId: string; signal: AbortSignal; }
export interface EmailDeliveryReceipt { transport: 'smtp'; messageId: string; }
export type EmailDeliveryFailure = 'delivery_failed' | 'delivery_timeout' | 'delivery_deferred' | 'delivery_rejected' | 'delivery_configuration';
export class EmailDeliveryError extends Error {
  readonly code: EmailDeliveryFailure;
  readonly retryable: boolean;
  constructor(code: EmailDeliveryFailure) {
    super(code); this.name = 'EmailDeliveryError'; this.code = code;
    this.retryable = code !== 'delivery_rejected';
  }
}
