const TENANT_HEADER='x-agvlog-tenant-id';
let activeTenantId:string|null=null;

export function getActiveTenantId(){return activeTenantId;}

export function setActiveTenantId(tenantId:string|null){
  activeTenantId=tenantId?.trim()||null;
}

export function clearActiveTenantId(expectedTenantId?:string){
  if(expectedTenantId===undefined||activeTenantId===expectedTenantId)activeTenantId=null;
}

function isTenantAwarePath(pathname:string){
  return pathname.startsWith('/rest/v1/')||pathname.startsWith('/functions/v1/')||pathname.startsWith('/storage/v1/');
}

export function activeTenantFetch(origin:string,fetcher:typeof fetch=globalThis.fetch):typeof fetch{
  return async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    const tenantId=activeTenantId;
    if(!tenantId||url.origin!==origin||!isTenantAwarePath(url.pathname))return fetcher(input,init);
    const headers=new Headers(typeof Request!=='undefined'&&input instanceof Request?input.headers:undefined);
    new Headers(init?.headers).forEach((value,key)=>headers.set(key,value));
    headers.set(TENANT_HEADER,tenantId);
    return fetcher(input,{...init,headers});
  };
}

export const ACTIVE_TENANT_HEADER=TENANT_HEADER;
