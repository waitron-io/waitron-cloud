import {connect,type Socket} from 'node:net';
import nodemailer from 'nodemailer';
import {relayBody,type RelayBody} from './relay-payload.ts';
export type RelayDelivery='accepted'|'temporary'|'refused'|'uncertain';
export type RelayContent=RelayBody&{managementOrigin:string};

/** Revalidate decrypted content before it can reach any SMTP field. */
export function relayTemplate(content:RelayContent){
 const {managementOrigin,...body}=content;
 relayBody(JSON.stringify(body),true);
 const origin=new URL(managementOrigin);
 if(origin.protocol!=='https:'||origin.origin!==managementOrigin)throw new Error('relay_unavailable');
 const spanish=body.locale.startsWith('es');
 const subject=body.class==='invitation'?(spanish?'Invitación a Waitron':'Your Waitron invitation')
  :body.class==='password_reset'?(spanish?'Restablece tu contraseña de Waitron':'Reset your Waitron password')
  :(spanish?'Confirma tu correo en Waitron':'Confirm your Waitron email');
 const link=new URL(body.class==='email_change'?'/':'/manage/account',origin);
 if(body.class!=='email_change'){link.search=new URLSearchParams({token:body.token!,purpose:body.class}).toString();link.hash=new URLSearchParams({email:body.recipient}).toString();}
 const expiry=new Intl.DateTimeFormat(body.locale,{dateStyle:'medium',timeStyle:'short',timeZone:body.timeZone}).format(new Date(body.codeExpiresAt??body.expiresAt));
 return {subject,text:`${body.displayName}\n\n${subject}\n${link.href}\n${body.class==='email_change'?`${spanish?'Código':'Code'}: ${body.code}\n`:''}${spanish?'Caduca':'Expires'}: ${expiry}\n`};
}

/** This adapter has no configurable host, sender or credentials: only disposable loopback capture. */
export function localRelaySmtp(port:number){
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('relay_unavailable');
 return async (content:RelayContent,signal:AbortSignal):Promise<RelayDelivery>=>{
  if(signal.aborted)return 'uncertain';
  const rendered=relayTemplate(content);
  let socket:Socket|undefined,cancelled=false,timer:ReturnType<typeof setTimeout>|undefined;
  let abortResult!:(result:RelayDelivery)=>void;
  const stopped=new Promise<RelayDelivery>(resolve=>{abortResult=resolve;});
  const abort=()=>{cancelled=true;socket?.destroy();abortResult('uncertain');};
  const transport=nodemailer.createTransport({host:'127.0.0.1',port,secure:false,ignoreTLS:true,
   logger:false,debug:false,transactionLog:false,disableFileAccess:true,disableUrlAccess:true,
   connectionTimeout:15000,greetingTimeout:15000,socketTimeout:15000,
   getSocket(_options,callback){
    if(cancelled||signal.aborted){callback(new Error('relay_unavailable'));return;}
    let returned=false;
    const done=(error:Error|null)=>{if(returned)return;returned=true;callback(error,error?undefined:{connection:socket!});};
    socket=connect({host:'127.0.0.1',port},()=>done(null));socket.on('error',done);
   }});
  try{
   signal.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,15000);
   const sent=transport.sendMail({from:{name:'Waitron',address:'relay@example.test'},to:{name:'',address:content.recipient},
    ...rendered,messageId:`<${content.messageId}@relay.example.test>`}).then((result):RelayDelivery=>
     result.accepted.length===1&&result.rejected.length===0?'accepted':'uncertain',classify);
   return await Promise.race([sent,stopped]);
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);socket?.destroy();transport.close();}
 };
}
function classify(error:unknown):RelayDelivery{
 const e=error&&typeof error==='object'?error as {responseCode?:number;command?:string;code?:string}:{};
 // An explicit negative reply confirms non-acceptance, including after DATA.
 if(e.responseCode&&e.responseCode>=500&&e.responseCode<600)return 'refused';
 if(e.responseCode&&e.responseCode>=400&&e.responseCode<500)return 'temporary';
 // Only commands demonstrably before DATA permit replay after a connection failure.
 if(e.code==='ECONNREFUSED'||['EHLO','HELO','MAIL FROM','RCPT TO'].includes(e.command??''))return 'temporary';
 return 'uncertain';
}
