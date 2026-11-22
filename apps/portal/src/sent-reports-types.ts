export interface SentReportSummary {
 installationId: string;
 reportId: string;
 reportedAt: string;
 version: string;
}

export interface SentReportsPage {
 venueId: string;
 reports: SentReportSummary[];
 nextCursor: string|null;
}

export interface SentReportDetail {
 venueId: string;
 installationId: string;
 reportId: string;
 reportBody: string;
 descriptionBody: string|null;
}

const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const encoder = new TextEncoder();
const body = (value: unknown) => typeof value === 'string' && value.length > 0 && encoder.encode(value).byteLength <= 16_384;

function fields(value: unknown, keys: string[]): value is Record<string, unknown> {
 return !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function validSentReportsPage(value: unknown): value is SentReportsPage {
 return fields(value, ['venueId', 'reports', 'nextCursor']) && uuid(value.venueId)
  && (value.nextCursor === null || typeof value.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value.nextCursor))
  && Array.isArray(value.reports) && value.reports.length <= 50
  && value.reports.every(r => fields(r, ['installationId', 'reportId', 'reportedAt', 'version'])
   && uuid(r.installationId) && uuid(r.reportId) && timestamp(r.reportedAt)
   && typeof r.version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(r.version))
  && new Set(value.reports.map(r => `${r.installationId}/${r.reportId}`)).size === value.reports.length;
}

export function validSentReportDetail(value: unknown): value is SentReportDetail {
 return fields(value, ['venueId', 'installationId', 'reportId', 'reportBody', 'descriptionBody'])
  && uuid(value.venueId) && uuid(value.installationId) && uuid(value.reportId)
  && body(value.reportBody) && (value.descriptionBody === null || body(value.descriptionBody));
}
