import {
 BadRequestException,CreateEmailIdentityCommand,DeleteEmailIdentityCommand,GetEmailIdentityCommand,
 LimitExceededException,NotFoundException,SESv2Client,TooManyRequestsException,type SESv2ClientConfig,
} from '@aws-sdk/client-sesv2';

const claimTag='waitron-venue-mail';
const deadline=()=>({abortSignal:AbortSignal.timeout(10000)});

export function createSesSigningProvider(config:SESv2ClientConfig){
 const client=new SESv2Client({...config,maxAttempts:1});
 return {
  async read(domain:string){
   try{
    const identity=await client.send(new GetEmailIdentityCommand({EmailIdentity:domain}),deadline());
    const dkim=identity.DkimAttributes;
    return {
     tag:identity.Tags?.find(tag=>tag.Key===claimTag)?.Value,
     selectors:dkim?.Tokens??[],
     external:dkim?.SigningAttributesOrigin==='EXTERNAL'&&dkim.SigningEnabled===true,
     verified:identity.IdentityType==='DOMAIN'&&identity.VerifiedForSendingStatus===true&&dkim?.Status==='SUCCESS',
    };
   }catch(error){
    if(error instanceof NotFoundException)return null;
    throw error;
   }
  },
  async create(domain:string,selector:string,tag:string,privateKey:string):Promise<'accepted'|'refused'>{
   try{
    await client.send(new CreateEmailIdentityCommand({
     EmailIdentity:domain,
     DkimSigningAttributes:{DomainSigningSelector:selector,DomainSigningPrivateKey:privateKey},
     Tags:[{Key:claimTag,Value:tag}],
    }),deadline());
    return 'accepted';
   }catch(error){
    if(error instanceof BadRequestException||error instanceof LimitExceededException||
     error instanceof NotFoundException||error instanceof TooManyRequestsException)return 'refused';
    throw error;
   }
  },
  async remove(domain:string){
   await client.send(new DeleteEmailIdentityCommand({EmailIdentity:domain}),deadline());
  },
  close(){client.destroy();},
 };
}
