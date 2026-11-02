import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {validateTrafficMapping} from '../src/traffic-mapping.ts';
import {validateTrafficMapping as coverageValidator} from '../src/traffic-coverage.ts';

const mapping={country:'ES',environment:'test',cellId:randomUUID(),directory:'/private/traffic',writerUid:0,readerGid:20};
test('country coverage retains the same pure mapping validator and exact ES test contract',()=>{
 assert.equal(coverageValidator,validateTrafficMapping);assert.doesNotThrow(()=>validateTrafficMapping(mapping));
});
for(const [name,change]of [
 ['foreign country',{country:'FR'}],['production environment',{environment:'production'}],['foreign-shaped cell',{cellId:'sol'}],
 ['relative directory',{directory:'traffic'}],['noncanonical directory',{directory:'/private/../traffic'}],
 ['negative owner',{writerUid:-1}],['fractional owner',{writerUid:1.5}],['unsafe owner',{writerUid:9007199254740992}],
 ['negative reader',{readerGid:-1}],['fractional reader',{readerGid:1.5}],['unsafe reader',{readerGid:9007199254740992}],['extra field',{extra:true}],
] as const)test(`pure traffic mapping refuses ${name}`,()=>{
 assert.throws(()=>validateTrafficMapping({...mapping,...change}),/^Error: traffic_authority_unavailable$/);
});
for(const value of [null,[],42,{},'mapping'])test(`pure traffic mapping refuses incomplete shape ${JSON.stringify(value)}`,()=>{
 assert.throws(()=>validateTrafficMapping(value),/^Error: traffic_authority_unavailable$/);
});
