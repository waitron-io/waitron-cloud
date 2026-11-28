import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Pool} from 'pg';
import {isPairingUuid} from '../../registration/src/pairing-proof.ts';
import {staffBugStatus} from './staff-bug-status.ts';

const testReport = `r.installation_id=$1 AND r.operation_id=$2 AND r.kind='staff' AND r.environment='test'
 AND r.staff_report_body IS NOT NULL`;
const testVenue = `FROM installations i JOIN venues v ON v.id=i.venue_id
 WHERE i.id=$1 AND v.environment='test'`;

let pool: Pool|undefined;
try {
 const [installationId, reportId, repository, issue, ...extra] = process.argv.slice(2);
 if (!process.env.DATABASE_URL || extra.length || !isPairingUuid(installationId) || !isPairingUuid(reportId)
  || (repository !== 'clintongormley/waitron' && repository !== 'waitron-io/waitron-cloud')
  || !issue || !/^[1-9][0-9]{0,9}$/.test(issue) || Number(issue) > 2147483647) throw new Error('invalid_input');
 pool = new Pool({connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 10000});
 pool.on('error', () => {});
 const target = [installationId, reportId];
 const found = await pool.query(`SELECT 1 FROM installation_error_reports r WHERE ${testReport} AND EXISTS (SELECT 1 ${testVenue})`, target);
 if (!found.rowCount) throw new Error('report_not_found');

 const {PATH, HOME, XDG_CONFIG_HOME, GH_CONFIG_DIR, GH_TOKEN, GITHUB_TOKEN} = process.env;
 const {stdout} = await promisify(execFile)('gh', ['api', '--hostname', 'github.com', `repos/${repository}/issues/${issue}`], {
  timeout: 5000, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL',
  env: {PATH, HOME, XDG_CONFIG_HOME, GH_CONFIG_DIR, GH_TOKEN, GITHUB_TOKEN, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1'},
 });
 const [status, fixedVersion] = staffBugStatus(JSON.parse(stdout));
 // Hold the venue environment through the write. The lookup above holds no database lock.
 const updated = await pool.query(`UPDATE installation_error_reports r SET
  bug_issue_repository=$3,bug_issue_number=$4,bug_status=$5,fixed_version=$6
  WHERE ${testReport} AND EXISTS (SELECT 1 ${testVenue} FOR SHARE OF v)`, [...target, repository, Number(issue), status, fixedVersion]);
 if (!updated.rowCount) throw new Error('report_not_found');
 console.log(JSON.stringify({status, fixedVersion}));
} catch {
 console.error('Staff bug status update failed. Check the test report, GitHub issue and database.');
 process.exitCode = 1;
} finally {
 try { await pool?.end(); } catch { process.exitCode = 1; }
}
