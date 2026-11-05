import assert from 'node:assert/strict';
import {appendFileSync} from 'node:fs';

try {
  const results = JSON.parse(process.env.CI_NIGHTLY_RESULTS);
  const families = ['standard', 'cost', 'venue'];
  assert.ok(results && typeof results === 'object' && !Array.isArray(results), 'Invalid nightly results');
  assert.ok(Object.keys(results).every(key => families.includes(key)), 'Unexpected nightly workflow');
  const rows = families.map(name => {
    const result = results[name]?.result;
    const status = ['success', 'failure', 'cancelled', 'skipped'].includes(result) ? result : 'missing or unfinished';
    return `| ${name} | ${status} |`;
  });
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `# Nightly full CI\n\n| Workflow | Result |\n| --- | --- |\n${rows.join('\n')}\n`);
  assert.ok(families.every(name => results[name]?.result === 'success'), 'Nightly full CI did not pass; inspect the failed or missing workflow before retrying');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
