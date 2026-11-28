import {BoxErrorReportError, parseBoxReportVersion} from '../../registration/src/box-error-reports.ts';

type BugStatus = ['open'|'in_progress', null] | ['fixed', string];

export function staffBugStatus(issue: unknown): BugStatus {
 if (!issue || typeof issue !== 'object' || 'pull_request' in issue || !('labels' in issue) || !Array.isArray(issue.labels)) {
  throw new Error('invalid_issue');
 }
 const labels = issue.labels.map((label: unknown) => {
  if (!label || typeof label !== 'object' || !('name' in label) || typeof label.name !== 'string') throw new Error('invalid_label');
  return label.name.toLowerCase();
 });
 const releases = labels.filter(name => name === 'fixed in' || name.startsWith('fixed in '));
 if (releases.length === 1) {
  const version = releases[0]!.slice('fixed in '.length);
  try {
   parseBoxReportVersion(version);
   return ['fixed', version];
  } catch (error) {
   if (!(error instanceof BoxErrorReportError)) throw error;
  }
 }
 return [labels.includes('in progress') ? 'in_progress' : 'open', null];
}
