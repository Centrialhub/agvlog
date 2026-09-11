export async function readBoundedBody(request:Request,maxBytes:number,timeoutMs=15000){
 if(!request.body)throw new Error('upload_empty_body');
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0,timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new Error('upload_body_timeout'));void reader.cancel().catch(()=>{});},timeoutMs);});
 try{
  while(true){const next=await Promise.race([reader.read(),timeout]);if(next.done)break;
   size+=next.value.length;if(size>maxBytes){await reader.cancel();throw new Error('upload_body_too_large');}chunks.push(next.value);
  }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
 }finally{if(timer!==undefined)clearTimeout(timer);reader.releaseLock();}
}
