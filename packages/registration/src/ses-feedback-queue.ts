/** Only a trusted adapter bound to the configured queue may supply envelopes. */
export interface SesFeedbackQueue {
 receive(signal:AbortSignal):Promise<{body:string;receiptHandle:string}[]>;
 delete(receiptHandle:string,signal:AbortSignal):Promise<void>;
 close():void;
}
