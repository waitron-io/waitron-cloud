import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {transaction} from '@waitron-cloud/registration';
import {guestMenuFixture} from './fixtures/guest-menu.ts';
import {guestMenuStatus,setGuestMenuBlocked,readGuestMenu} from '../src/guest-menu.ts';

const origin='https://menus.example.test';
let f:Awaited<ReturnType<typeof guestMenuFixture>>,db:Awaited<ReturnType<typeof guestMenuFixture>>['db'],venueId:string;
before(async()=>{
 f=await guestMenuFixture();({db,venueId}=f);
});
after(async()=>db?.close());

test('a stored public copy has one permanent link; takedown removes bytes and Enable leaves it off',async()=>{
 const status=()=>transaction(db.pool,c=>guestMenuStatus(c,venueId,origin));
 assert.deepEqual(await status(),{version:1,url:`${origin}/m/${venueId}`,revision:0,state:'off',publication:null});
 await f.seed();
 assert.equal((await status()).state,'current');
 assert.equal((await readGuestMenu(db.pool,venueId,'es'))?.html,'<h1>Menú</h1>');
 assert.equal((await readGuestMenu(db.pool,venueId,'ca'))?.html,'<h1>Menu</h1>');
 assert.equal(await readGuestMenu(db.pool,randomUUID()),null);
 const blocked=await transaction(db.pool,c=>setGuestMenuBlocked(c,venueId,true,origin));
 assert.equal(blocked.state,'blocked');assert.equal(blocked.revision,2);assert.equal(blocked.publication,null);
 assert.deepEqual(await transaction(db.pool,c=>setGuestMenuBlocked(c,venueId,true,origin)),blocked);
 assert.equal(await readGuestMenu(db.pool,venueId),null);
 assert.equal((await db.pool.query('SELECT pages FROM guest_menus WHERE venue_id=$1',[venueId])).rows[0].pages,null);
 const enabled=await transaction(db.pool,c=>setGuestMenuBlocked(c,venueId,false,origin));
 assert.equal(enabled.state,'off');assert.equal(enabled.revision,3);
 assert.deepEqual(await transaction(db.pool,c=>setGuestMenuBlocked(c,venueId,false,origin)),enabled);
 assert.equal(await readGuestMenu(db.pool,venueId),null);
});
