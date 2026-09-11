import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

interface CachedResponse {
  ok:boolean;
  clone:()=>CachedResponse;
  text:()=>Promise<string>;
  json:()=>Promise<unknown>;
}

type WorkerHandler=(event:Record<string,unknown>)=>void;

function response(body:string|unknown,ok=true):CachedResponse {
  const text=typeof body==='string'?body:JSON.stringify(body);
  return {ok,clone:()=>response(body,ok),text:async()=>text,json:async()=>JSON.parse(text)};
}

function pathOf(request:unknown){
  if(typeof request==='string')return new URL(request,'https://app.test').pathname;
  if(request&&typeof request==='object'&&'url'in request)return new URL(String(request.url)).pathname;
  throw new Error('invalid request');
}

function serviceWorkerHarness(shared:{stores:Map<string,Map<string,CachedResponse>>;indexedDB:{pending:Map<string,unknown>;deleteDatabase:ReturnType<typeof vi.fn>}},
  hash:string,failPath?:string){
  const handlers=new Map<string,WorkerHandler>(),claim=vi.fn(async()=>undefined),skipWaiting=vi.fn();let online=true;
  const fetch=async(request:unknown)=>{
    const path=pathOf(request);if(!online||path===failPath)throw new Error('offline');
    if(path==='/')return response('<html><script src="/assets/index.js"></script></html>');
    if(path==='/driver-shell-assets.json')return response(['/assets/DriverDeliveries.js']);
    return response(`asset:${path}`);
  };
  const caches={
    open:async(name:string)=>{
      if(!shared.stores.has(name))shared.stores.set(name,new Map());const entries=shared.stores.get(name)!;
      return {put:async(request:unknown,value:CachedResponse)=>{entries.set(pathOf(request),value);},
        addAll:async(paths:string[])=>{for(const path of paths)entries.set(path,(await fetch(path)).clone());},
        match:async(request:unknown)=>entries.get(pathOf(request))};
    },
    keys:async()=>[...shared.stores.keys()],
    delete:async(name:string)=>shared.stores.delete(name),
    match:async(request:unknown)=>{const path=pathOf(request);for(const entries of shared.stores.values()){
      const found=entries.get(path);if(found)return found;}return undefined;},
  };
  const self={location:{origin:'https://app.test'},clients:{claim},skipWaiting,
    addEventListener:(type:string,handler:WorkerHandler)=>handlers.set(type,handler)};
  const template=readFileSync(join(process.cwd(),'public','sw.js'),'utf8');
  runInNewContext(template.split('__AGVLOG_BUILD_HASH__').join(hash),{self,caches,fetch,URL,Promise,Set,Error,indexedDB:shared.indexedDB});
  const waitFor=(type:string,event:Record<string,unknown>={})=>new Promise<void>((resolve,reject)=>{
    let task:Promise<unknown>|undefined;
    handlers.get(type)?.({...event,waitUntil:(value:Promise<unknown>)=>{task=Promise.resolve(value);}});
    if(!task){reject(new Error(`${type} did not register waitUntil`));return;}task.then(()=>resolve(),reject);
  });
  return {handlers,claim,skipWaiting,setOffline:()=>{online=false;},waitFor};
}

describe('driver PWA safe build upgrade',()=>{
  it('keeps the complete active cache when installation of the next build fails',async()=>{
    const shared={stores:new Map<string,Map<string,CachedResponse>>(),indexedDB:{pending:new Map<string,unknown>(),deleteDatabase:vi.fn()}};
    const active=serviceWorkerHarness(shared,'build-one');await active.waitFor('install');await active.waitFor('activate');
    const broken=serviceWorkerHarness(shared,'build-broken','/assets/DriverDeliveries.js');
    await expect(broken.waitFor('install')).rejects.toThrow('offline');
    expect([...shared.stores.keys()]).toEqual(['agvlog-driver-shell-build-one']);
  });

  it('upgrades, reloads offline and preserves pending commands with blobs',async()=>{
    const pendingBlob=new Blob(['canhoto-pendente'],{type:'image/jpeg'}),pendingId='delivery-request-1';
    const shared={stores:new Map<string,Map<string,CachedResponse>>(),indexedDB:{pending:new Map<string,unknown>([[pendingId,{kind:'delivery',files:[pendingBlob]}]]),
      deleteDatabase:vi.fn()}};
    const first=serviceWorkerHarness(shared,'build-one');await first.waitFor('install');await first.waitFor('activate');
    const next=serviceWorkerHarness(shared,'build-two');await next.waitFor('install');
    expect([...shared.stores.keys()].sort()).toEqual(['agvlog-driver-shell-build-one','agvlog-driver-shell-build-two']);
    next.handlers.get('message')?.({data:{type:'ACTIVATE_UPDATE'}});expect(next.skipWaiting).toHaveBeenCalledOnce();
    await next.waitFor('activate');
    expect([...shared.stores.keys()]).toEqual(['agvlog-driver-shell-build-two']);

    next.setOffline();let offlineResponse:Promise<CachedResponse|undefined>|undefined;
    next.handlers.get('fetch')?.({request:{method:'GET',url:'https://app.test/driver',mode:'navigate',destination:'document'},
      respondWith:(value:Promise<CachedResponse|undefined>)=>{offlineResponse=value;}});
    expect(await (await offlineResponse)!.text()).toContain('/assets/index.js');
    const saved=shared.indexedDB.pending.get(pendingId) as {files:Blob[]};
    expect(saved.files[0]).toBe(pendingBlob);
    expect(saved.files[0]).toMatchObject({size:pendingBlob.size,type:'image/jpeg'});
    expect(shared.indexedDB.deleteDatabase).not.toHaveBeenCalled();
  });
});
