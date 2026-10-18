import {createRequire} from 'node:module';
import {accountMail} from '../../packages/registration/src/account-mail.ts';
const nodemailer=createRequire(new URL('../../packages/registration/package.json',import.meta.url))('nodemailer');
export function createTestCaptureMailer(options){
 if(!options||Object.keys(options).some(key=>!['origin','port'].includes(key))||options.origin!=='https://waitron.local:3000'||!Number.isInteger(options.port??1025)||(options.port??1025)<1||(options.port??1025)>65535)throw new Error('test_cloud.mail_configuration');
 const origin=new URL(options.origin),port=options.port??1025;
 const action=async(kind,message)=>{
  const rendered=accountMail(origin,kind,message);
  const transport=nodemailer.createTransport({host:'127.0.0.1',port,secure:false,ignoreTLS:true,logger:false,debug:false,connectionTimeout:5000,greetingTimeout:5000,socketTimeout:5000,disableFileAccess:true,disableUrlAccess:true});
  try{await transport.sendMail({from:'Waitron Cloud <cloud@example.test>',to:{address:message.email,name:''},subject:rendered.subject,text:rendered.text});}
  catch{throw new Error('Test capture delivery failed');}finally{transport.close();}
 };
 return {sendVerification:message=>action('verification',message),sendPasswordReset:message=>action('password_reset',message),sendPasswordChanged:message=>action('password_changed',message),sendServiceAlert:message=>action('service_alert',message)};
}
