import {readFileSync} from 'node:fs';
import {createPrivateKey,sign} from 'node:crypto';
import {encodeMachine} from '@waitron-cloud/registration';
import {jobFingerprint} from '../src/submit-proof.ts';

const vector=JSON.parse(readFileSync(new URL('../../registration/test/installation-vector.json',import.meta.url),'utf8'));
const key=createPrivateKey({key:Buffer.from(vector.privateKey,'base64url'),format:'der',type:'pkcs8'});
const {origin,installationId,issuedAt}=vector.claims,lease=JSON.stringify(vector.lease);
const operationId='52345678-1234-4234-8234-123456789abc';
const job=(staffName:string)=>JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},
  items:[{ref:'variant:812',kind:'variant',family:'product:640',category:'TAP BEERS',staffName,existing:{en:'Pint'},missing:['ca','es']}],
  houseStyle:[{kind:'product',staffName:'CARAJILLO',names:{ca:'Cigaló',es:'Carajillo'}}]});
function envelope(signedBody:string,body:string){
  const payload=encodeMachine({origin,action:'translation-submit',installationId,operationId,issuedAt,lease,body:signedBody});
  return {payload:payload.toString('base64url'),signature:sign(null,payload,key).toString('base64url'),body};
}
const valid=job('PINTA'),fingerprint=jobFingerprint(valid),signed=JSON.stringify({version:1,...fingerprint});
const other=job('CANYA');
const cases=[
  {name:'valid',expect:'accepted',envelope:envelope(signed,valid)},
  {name:'changed_body',expect:'401 invalid_proof',envelope:{...envelope(signed,valid),body:valid.replace('PINTA','PINTO')}},
  {name:'wrong_length',expect:'401 invalid_proof',envelope:envelope(JSON.stringify({version:1,jobSha256:fingerprint.jobSha256,jobBytes:fingerprint.jobBytes+1}),valid)},
  {name:'replayed_operation',expect:'409 conflict after valid',envelope:envelope(JSON.stringify({version:1,...jobFingerprint(other)}),other)},
];
process.stdout.write(JSON.stringify({origin,installationId,operationId,issuedAt,publicKey:vector.publicKey,issuerPublicKey:vector.issuerPublicKey,issuerKeyId:vector.issuerKeyId,lease:vector.lease,cases},null,2)+'\n');
