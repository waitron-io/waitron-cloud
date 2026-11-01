import {test} from 'node:test';
import {checkServiceReceipt} from './fixtures/service-proof.ts';

test('legacy service receipt retains every existing fixture check',{timeout:360000},async()=>{
 await checkServiceReceipt(false,new URL('../',import.meta.url).pathname);
});
