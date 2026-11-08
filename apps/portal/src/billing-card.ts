type CardApi={mount(options:{id:string;checkoutId:string;locale:string;onResponse:(type:string)=>void}):{unmount():void}};
declare global{interface Window{SumUpCard?:CardApi}}
let loading:Promise<CardApi>|undefined;
function sdk():Promise<CardApi>{
 if(window.SumUpCard)return Promise.resolve(window.SumUpCard);
 if(!loading)loading=new Promise<CardApi>((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js';script.async=true;
  const fail=()=>{clearTimeout(timer);script.remove();reject(new Error('widget_unavailable'));};
  const timer=setTimeout(fail,15000);
  script.onload=()=>{clearTimeout(timer);if(window.SumUpCard)resolve(window.SumUpCard);else fail();};script.onerror=fail;document.head.append(script);
 }).catch(error=>{loading=undefined;throw error;});
 return loading;
}
class BillingCard extends HTMLElement{
 #checkout='';#locale='en';#revision=0;#widget:ReturnType<CardApi['mount']>|undefined;
 readonly #hide=()=>this.#stop();
 set checkoutId(value:string){if(value!==this.#checkout){this.#checkout=value;this.#start();}}
 set locale(value:string){if(value!==this.#locale){this.#locale=value;this.#start();}}
 connectedCallback(){window.addEventListener('pagehide',this.#hide);this.#start();}
 disconnectedCallback(){window.removeEventListener('pagehide',this.#hide);this.#stop();}
 #stop(){this.#revision++;try{this.#widget?.unmount();}catch{/* Removing the owned container also removes any remaining provider frame. */}finally{this.#widget=undefined;this.replaceChildren();}}
 #start(){
  this.#stop();if(!this.isConnected||!this.#checkout)return;
  const revision=this.#revision,container=document.createElement('div');container.id='billing-card-'+crypto.randomUUID();this.append(container);
  void sdk().then(api=>{
   if(!this.isConnected||revision!==this.#revision)return;
   this.#widget=api.mount({id:container.id,checkoutId:this.#checkout,locale:this.#locale==='es'?'es-ES':'en-GB',onResponse:type=>{
    if(this.isConnected&&revision===this.#revision&&['success','fail','error'].includes(type))this.dispatchEvent(new Event('method-result'));
   }});
  }).catch(()=>{if(this.isConnected&&revision===this.#revision)this.dispatchEvent(new Event('widget-unavailable'));});
 }
}
customElements.define('billing-card',BillingCard);
