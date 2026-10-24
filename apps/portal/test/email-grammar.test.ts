import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normaliseEmail} from '@waitron-cloud/registration';
const portal = await import('../src/email.ts').catch(() => null);
const cases: [string,boolean][] = [
 ['ana@example.com',true],['ANA@EXAMPLE.COM',true],[' ana@example.com ',true],
 ['\u00a0ana@example.com\u00a0',true],['ana.garcia+cloud@example.co.uk',true],
 ["a!#$%&'*+/=?^_`{|}~-@example.test",true],['ana@ex-ample.test',true],
 ['a'.repeat(64)+'@example.test',true],['ana@'+'b'.repeat(63)+'.test',true],
 ['a'.repeat(64)+'@'+'b'.repeat(63)+'.'+'c'.repeat(63)+'.'+'d'.repeat(61),true],
 ['',false],['   ',false],['ana..garcia@example.com',false],['josé@example.es',false],
 ['ana@example..com',false],['ana@-example.com',false],['ana@example-.com',false],
 ['.ana@example.com',false],['ana.@example.com',false],['ana @example.com',false],
 ['ana@example .com',false],['ana@example',false],['ana@@example.com',false],
 ['"ana"@example.com',false],['\u200bana@example.com',false],['ana@ex_ample.com',false],
 ['a'.repeat(65)+'@example.test',false],['ana@'+'b'.repeat(64)+'.test',false],
 ['a'.repeat(64)+'@'+'b'.repeat(63)+'.'+'c'.repeat(63)+'.'+'d'.repeat(62),false],
];
for (const [address,accepted] of cases) test(`portal and server ${accepted?'accept':'refuse'} ${JSON.stringify(address)}`, () => {
 assert.equal(Boolean(normaliseEmail(address)),accepted,'server expectation is hand checked');
 assert.equal(typeof portal?.validEmail,'function','the portal email check must be available');
 assert.equal(portal!.validEmail(address),accepted,'portal must follow the server grammar');
});
