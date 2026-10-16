import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import {stripVTControlCharacters} from 'node:util';
import {packageMembers} from './ci-package-groups.mjs';

function testCounts(output) {
  output = stripVTControlCharacters(output);
  const counts = {};
  for (const field of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...output.matchAll(new RegExp(`^(?:# |ℹ )${field} (.*)$`, 'gm'))];
    assert.ok(matches.length === 1 && /^(0|[1-9][0-9]*)$/.test(matches[0][1]), `Invalid test summary: ${field}`);
    counts[field] = Number(matches[0][1]);
    assert.ok(Number.isSafeInteger(counts[field]), `Invalid test summary: ${field}`);
  }
  assert.ok(counts.tests > 0 && counts.pass > 0 && counts.fail === 0 && counts.cancelled === 0 &&
    counts.tests === counts.pass + counts.skipped + counts.todo, 'Invalid test summary: incomplete or unsuccessful tests');
  return counts;
}

async function runPackage(name) {
  const child = spawn('pnpm', ['--filter', name, 'test'], {stdio: ['inherit', 'pipe', 'inherit']});
  let tail = '', error;
  const decoder = new StringDecoder('utf8');
  // Forward all output, retaining only a bounded tail for Node's final summary.
  child.stdout.pipe(process.stdout, {end: false});
  child.stdout.on('data', chunk => {tail = (tail + decoder.write(chunk)).slice(-64 * 1024);});
  child.on('error', cause => {error = cause.message;});
  const result = await new Promise(resolve => child.on('close', (status, signal) => resolve({status, signal})));
  tail += decoder.end();
  if (error || result.status !== 0) return {error: error ?? result.signal ?? result.status};
  try {return {counts: testCounts(tail)};}
  catch (cause) {return {error: cause.message};}
}

try {
  const row = JSON.parse(process.env.CI_PACKAGE_GROUP);
  const members = packageMembers(row);
  assert.ok(Object.hasOwn(row, 'members'), 'Missing package group members');
  let failed = false;
  // A failed package must remain visible without hiding later selected results.
  for (const name of members) {
    console.log(`::group::${name}`);
    const started = performance.now();
    const {counts, error} = await runPackage(name);
    const passed = Boolean(counts);
    const summary = passed ? `${counts.tests} tests, ${counts.pass} passed, ${counts.skipped} skipped, ${counts.todo} todo; ` : '';
    console.log(`Package ${name}: ${passed ? 'PASS' : 'FAIL'} (${summary}${Math.round(performance.now() - started)} ms)`);
    console.log('::endgroup::');
    if (!passed) {
      failed = true;
      console.error(`Package ${name} failed: ${error}`);
    }
  }
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
