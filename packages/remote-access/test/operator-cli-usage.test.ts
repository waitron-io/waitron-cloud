import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

test('operator help offers no manual certificate command',()=>{
 const result=spawnSync(process.execPath,['src/operator-cli.ts'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
 assert.equal(result.status,1);assert.match(result.stderr,/Usage: operator-cli.ts/);assert.doesNotMatch(result.stderr,/\|certificate\b/);
});
