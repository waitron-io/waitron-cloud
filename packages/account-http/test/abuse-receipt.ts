type ObjectValue = Record<string, any>;

const fail = (): never => {throw new Error('Invalid cloud abuse receipt');};
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

function quota(value: unknown) {
  if (!object(value) || !integer(value.attempts) || !integer(value.admitted) || !integer(value.refused)
    || value.attempts !== value.admitted + value.refused || value.admitted === 0 || value.refused === 0) fail();
}

function timings(value: unknown, floor = 0) {
  if (!object(value) || !integer(value.samples) || value.samples === 0 || !positive(value.min)
    || !positive(value.median) || !positive(value.max) || value.min < floor
    || value.min > value.median || value.median > value.max) fail();
}

function codes(value: unknown) {
  if (!object(value) || value.guessedIds !== 5 || value.targetFailuresAfterGuesses !== 0
    || value.knownIdFailures !== 5 || value.correctCodeRefused !== true) fail();
}

export function verifyCloudAbuseReceipt(receipt: unknown): ObjectValue {
  if (!object(receipt)) fail();
  const value = receipt as ObjectValue;
  if (value.schemaVersion !== 1 || typeof value.cloudHead !== 'string' || !/^[0-9a-f]{40}$/.test(value.cloudHead) || typeof value.cloudDirty !== 'boolean'
    || typeof value.measuredAt !== 'string' || new Date(value.measuredAt).toISOString() !== value.measuredAt
    || !object(value.environment) || typeof value.environment.node !== 'string' || !value.environment.node
    || typeof value.environment.cpuModel !== 'string' || !value.environment.cpuModel
    || !integer(value.environment.cpuCount) || value.environment.cpuCount === 0
    || !object(value.account) || !object(value.operations)) fail();
  quota(value.account.sharedIp);
  quota(value.account.sharedAddress);
  if (!object(value.account.sharedAddress) || value.account.sharedAddress.legitimateRefused !== true || !object(value.account.cooldown)
    || value.account.cooldown.attempts !== 8 || value.account.cooldown.accepted !== 8
    || value.account.cooldown.messagesQueued !== 1) fail();
  timings(value.account.passwordHashMs);
  if (!object(value.account.responseFloorMs)) fail();
  timings(value.account.responseFloorMs.known, 285);
  timings(value.account.responseFloorMs.unknown, 285);
  quota(value.operations.pairingSharedIp);
  quota(value.operations.recoverySharedIp);
  codes(value.operations.pairingCodes);
  codes(value.operations.recoveryCodes);
  return value;
}
