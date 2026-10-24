import assert from 'node:assert/strict';
import {test} from 'node:test';
import {formatBytes} from '../src/usage-screen.ts';

for(const locale of ['en','es'] as const){
 const label=locale==='en'?'bytes':'octetos';
 for(const [decimal,want] of [
  ['1048535','1 MiB'],['1073741000','1 GiB'],['1099511627775','1 TiB'],
  ['1048525','1 MiB'],['-1048535','-1 MiB'],['-1073741000','-1 GiB'],
  ['-1099511627775','-1 TiB'],
 ] as const)test(`${locale}: rounded ${decimal} bytes uses the next unit`,()=>{
  assert.equal(formatBytes(decimal,locale,label),want);
 });
 for(const [decimal,en,es] of [
  ['0','0 bytes','0 octetos'],['1023','1,023 bytes','1023 octetos'],
  ['1024','1 KiB','1 KiB'],['-1023','-1,023 bytes','-1023 octetos'],
  ['-1024','-1 KiB','-1 KiB'],['1536','1.5 KiB','1,5 KiB'],
  ['1048524','1,023.9 KiB','1023,9 KiB'],
  ['-1048524','-1,023.9 KiB','-1023,9 KiB'],
  ['1048576','1 MiB','1 MiB'],['1073741824','1 GiB','1 GiB'],
  ['1125899906842623','1,024 TiB','1024 TiB'],
  ['9007199254740993','9,007,199,254,740,993 bytes','9.007.199.254.740.993 octetos'],
  ['-9007199254740993','-9,007,199,254,740,993 bytes','-9.007.199.254.740.993 octetos'],
 ] as const)test(`${locale}: ${decimal} bytes preserves scale and precision`,()=>{
  assert.equal(formatBytes(decimal,locale,label),locale==='en'?en:es);
 });
}
