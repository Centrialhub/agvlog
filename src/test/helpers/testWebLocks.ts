// In-process implementation of the public exclusive Web Locks contract for
// deterministic tests. This is not a real cross-tab/browser verification.
export function installTestWebLocks(){
  const previous=Object.getOwnPropertyDescriptor(navigator,'locks');
  const held=new Set<string>(),queues=new Map<string,Array<()=>void>>();
  const calls:Array<{name:string;options:LockOptions}>=[];
  const manager={request<T>(name:string,options:LockOptions,callback:(lock:Lock|null)=>T|PromiseLike<T>):Promise<T>{
    calls.push({name,options});
    if(options.steal)throw new Error('Tests forbid stealing a live Auth lock');
    if(options.ifAvailable&&held.has(name))return Promise.resolve(callback(null));
    return new Promise<T>((resolve,reject)=>{
      let cancelled=false;
      const abort=()=>{cancelled=true;reject(new DOMException('Aborted','AbortError'));};
      const grant=()=>{
        if(cancelled){next();return;}
        options.signal?.removeEventListener('abort',abort);held.add(name);
        void Promise.resolve().then(()=>callback({name,mode:'exclusive'})).then(resolve,reject).finally(()=>{held.delete(name);next();});
      };
      const next=()=>{const queue=queues.get(name);const work=queue?.shift();if(!queue?.length)queues.delete(name);work?.();};
      if(options.signal?.aborted){abort();return;}
      options.signal?.addEventListener('abort',abort,{once:true});
      if(held.has(name)){const queue=queues.get(name)??[];queue.push(grant);queues.set(name,queue);}else grant();
    });
  }} as LockManager;
  Object.defineProperty(navigator,'locks',{configurable:true,value:manager});
  return {calls,restore:()=>{if(previous)Object.defineProperty(navigator,'locks',previous);else Reflect.deleteProperty(navigator,'locks');}};
}
