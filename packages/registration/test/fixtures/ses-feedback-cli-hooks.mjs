import {registerHooks} from 'node:module';

const cli=new URL('../../src/ses-feedback-cli.ts',import.meta.url).href;
const policy=JSON.parse(process.env.LOCAL_FEEDBACK_POLICY);
// Only this child command receives synthetic qualification and an in-memory wire.
registerHooks({resolve(specifier,context,next){
 if(context.parentURL===cli&&specifier==='./country-policy.ts')return {
  url:'data:text/javascript,'+encodeURIComponent(`export const spainCountryPolicy=${JSON.stringify(policy)};`),shortCircuit:true};
 if(context.parentURL===cli&&specifier==='./ses-feedback-queue.ts')return {
  url:new URL('./ses-feedback-cli-wire.mjs',import.meta.url).href,shortCircuit:true};
 return next(specifier,context);
}});
process.once('beforeExit',code=>console.log(JSON.stringify({drained:true,code})));
