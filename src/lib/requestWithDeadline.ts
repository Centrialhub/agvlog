// An aborted request can still have committed. Recover the original command.
export async function requestWithDeadline<T>(send:(signal:AbortSignal)=>PromiseLike<T>):Promise<T>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([Promise.resolve().then(()=>send(controller.signal)),new Promise<never>((_,reject)=>{
  timer=setTimeout(()=>{controller.abort();reject(new Error('Tempo esgotado sem confirmação. Recupere o mesmo pedido.'));},30000);
 })]);}finally{clearTimeout(timer);}
}
