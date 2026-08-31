const AUTH_REQUEST_TIMEOUT = 5000;
// Scope the deadline to Auth, including its response body. Operational uploads,
// fiscal responses and PostgREST keep their existing transport policies.
export function boundedAuthFetch(origin:string,fetcher:typeof fetch=globalThis.fetch):typeof fetch{
  return async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(url.origin!==origin||!url.pathname.startsWith('/auth/v1/'))return fetcher(input,init);
    const controller=new AbortController(),source=init?.signal??(typeof Request!=='undefined'&&input instanceof Request?input.signal:undefined);
    let settled=false,timer:ReturnType<typeof setTimeout>|undefined;
    let rejectAbort:(reason:Error)=>void=()=>{};
    const abort=()=>{controller.abort();rejectAbort(new Error('A requisição de autenticação foi interrompida.'));};
    try{
      const stopped=new Promise<never>((_,reject)=>{rejectAbort=reject;});
      source?.addEventListener('abort',abort,{once:true});if(source?.aborted)abort();
      timer=setTimeout(()=>{controller.abort();rejectAbort(new Error('Tempo esgotado na autenticação.'));},AUTH_REQUEST_TIMEOUT);
      return await Promise.race([stopped,(async()=>{
        if(controller.signal.aborted)throw new Error('Autenticação interrompida.');
        const response=await fetcher(input,{...init,signal:controller.signal});
        if(settled||controller.signal.aborted)throw new Error('Resposta de autenticação obsoleta.');
        const body=await response.text();
        if(settled||controller.signal.aborted)throw new Error('Resposta de autenticação obsoleta.');
        return new Response([204,205,304].includes(response.status)?null:body,{status:response.status,statusText:response.statusText,headers:response.headers});
      })()]);
    }finally{settled=true;clearTimeout(timer);source?.removeEventListener('abort',abort);}
  };
}
