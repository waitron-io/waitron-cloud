export type AccountSessionSummary = {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function validAccountSession(value: unknown): value is AccountSessionSummary {
  return object(value) && typeof value.id === 'string' && UUID.test(value.id)
    && date(value.createdAt) && date(value.lastUsedAt) && date(value.expiresAt) && typeof value.current === 'boolean';
}

export function validAccountSessions(value: unknown): value is {sessions: AccountSessionSummary[]} {
  return object(value) && Array.isArray(value.sessions)
    && value.sessions.every(validAccountSession) && value.sessions.filter(session => session.current).length === 1;
}
