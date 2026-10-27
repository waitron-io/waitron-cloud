(async()=>{
 document.querySelector('div').hidden=false;
 let worker,timer,controller,finished=false;
 const stop=()=>{clearTimeout(timer);if(worker)worker.terminate();if(controller)controller.abort();};
 const fail=(browser=false)=>{if(finished)return;finished=true;stop();document.querySelector('p').innerHTML=browser?'This browser check could not finish. Try another browser, update it and check that JavaScript is allowed. / <span lang="es">No se pudo completar la comprobación. Prueba con otro navegador, actualízalo y comprueba que JavaScript esté permitido.</span>':'Please reload to try again. / <span lang="es">Vuelve a cargar para intentarlo de nuevo.</span>';};
 try{
  timer=setTimeout(()=>fail(true),30000);
  try{controller=new AbortController();}catch{fail(true);return;}
  const challenge=await(await fetch('/_cloud/challenge',{signal:controller.signal})).json();if(finished)return;
  try{worker=new Worker('/_cloud/worker.js');}catch{fail(true);return;}
  worker.onmessage=async({data})=>{if(finished)return;if(data&&data.error){fail(true);return;}try{worker.terminate();const reply=await fetch('/_cloud/solve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:controller.signal});if(finished)return;if(!reply.ok)throw Error();finished=true;stop();location.replace('/public/availability');}catch{fail();}};
  worker.onerror=()=>fail(true);worker.postMessage(challenge);
 }catch{fail();}
})();