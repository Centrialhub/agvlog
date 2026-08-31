import {chatCommandSchema,parseChatAck,type ChatInput,type ChatCommand} from './chatCommands';
export const CHAT_OUTBOX_CHANGED='agvlog:chat-outbox-changed';
export const CHAT_MESSAGE_CONFIRMED='agvlog:chat-message-confirmed';
const keyFor=(tenant:string,actor:string)=>'agvlog:driver-chat:v1:'+tenant+':'+actor;
const unavailable=()=>new Error('Recuperação do chat indisponível ou incompatível. Nenhuma nova mensagem foi enviada.');
export interface PendingChat{version:1;tenantId:string;actorId:string;payload:ChatCommand}
export function pendingChat(storage:Storage,tenant:string,actor:string):PendingChat|null{
 try{
  for(let n=0;n<storage.length;n++){const k=storage.key(n);if(k?.startsWith('agvlog:driver-chat:')&&k.endsWith(':'+tenant+':'+actor)&&k!==keyFor(tenant,actor))throw unavailable();}
  const raw=storage.getItem(keyFor(tenant,actor));if(!raw)return null;if(raw.length>30000)throw unavailable();const row=JSON.parse(raw) as PendingChat;
  if(row.version!==1||row.tenantId!==tenant||row.actorId!==actor)throw unavailable();const payload=chatCommandSchema.parse(row.payload);
  if(payload.tenant_id!==tenant||payload.actor_id!==actor)throw unavailable();return {...row,payload};
 }catch{throw unavailable();}
}
interface Dependencies{storage:Storage;uuid:()=>string;assertContext:()=>void;changed:()=>void;lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;send:(p:ChatCommand)=>PromiseLike<{data:unknown;error:unknown}>}
export function createChatOutbox(deps:Dependencies){
 let inFlight:Promise<ReturnType<typeof parseChatAck>>|null=null;
 const run=(tenant:string,actor:string,input?:ChatInput)=>{
  if(inFlight)return inFlight;
  const work=deps.lock(keyFor(tenant,actor),async()=>{
   deps.assertContext();let row=pendingChat(deps.storage,tenant,actor);const uncertain=!!row;
   if(row&&input)throw new Error('Há uma mensagem pendente. Recupere a confirmação antes de iniciar outra.');
   if(!row){if(!input)throw new Error('Nenhuma mensagem pendente nesta sessão.');
    const payload=chatCommandSchema.parse({...input,version:1,tenant_id:tenant,actor_id:actor,request_id:deps.uuid()});
    row={version:1,tenantId:tenant,actorId:actor,payload};try{deps.storage.setItem(keyFor(tenant,actor),JSON.stringify(row));}catch{throw unavailable();}deps.changed();}
   deps.assertContext();const forget=()=>{try{deps.storage.removeItem(keyFor(tenant,actor));}catch{/* keep exact replay */}deps.changed();};
   const {data,error}=await deps.send(row.payload);deps.assertContext();
   if(error){const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
    if(!uncertain&&(/^(22|23)/.test(code)||['40001','40P01','55P03','42501','55000'].includes(code)))forget();throw error;}
   const ack=parseChatAck(data,row.payload);forget();return ack;
  });inFlight=work;void work.finally(()=>{if(inFlight===work)inFlight=null;deps.changed();}).catch(()=>{});return work;
 };
 return {submit:(tenant:string,actor:string,input:ChatInput)=>run(tenant,actor,input),recover:(tenant:string,actor:string)=>run(tenant,actor)};
}
