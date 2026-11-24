import {chatCommandSchema,parseChatAck,type ChatInput,type ChatCommand} from './chatCommands';
export const CHAT_OUTBOX_CHANGED='agvlog:chat-outbox-changed';
export const CHAT_MESSAGE_CONFIRMED='agvlog:chat-message-confirmed';
export interface AgentChatScope{driverId:string;agentId:string}
const keyFor=(tenant:string,actor:string,scope?:AgentChatScope)=>scope
 ?'agvlog:driver-agent-chat:v1:'+tenant+':'+actor+':'+scope.driverId+':'+scope.agentId
 :'agvlog:driver-chat:v1:'+tenant+':'+actor;
const unavailable=()=>new Error('Recuperação do chat indisponível ou incompatível. Nenhuma nova mensagem foi enviada.');
export interface PendingChat{version:1;tenantId:string;actorId:string;payload:ChatCommand}
export function pendingChat(storage:Storage,tenant:string,actor:string,scope?:AgentChatScope):PendingChat|null{
 try{
  for(let n=0;n<storage.length;n++){const k=storage.key(n);const prefix=scope?'agvlog:driver-agent-chat:':'agvlog:driver-chat:';
   const suffix=':'+tenant+':'+actor+(scope?':'+scope.driverId+':'+scope.agentId:'');
   if(k?.startsWith(prefix)&&k.endsWith(suffix)&&k!==keyFor(tenant,actor,scope))throw unavailable();}
  const raw=storage.getItem(keyFor(tenant,actor,scope));if(!raw)return null;if(raw.length>30000)throw unavailable();const row=JSON.parse(raw) as PendingChat;
  if(row.version!==1||row.tenantId!==tenant||row.actorId!==actor)throw unavailable();const payload=chatCommandSchema.parse(row.payload);
  if(payload.tenant_id!==tenant||payload.actor_id!==actor||payload.agent_user_id!==scope?.agentId||(scope&&payload.driver_id!==scope.driverId))throw unavailable();return {...row,payload};
 }catch{throw unavailable();}
}
export function pendingAgentChatScopes(storage:Storage,tenant:string,actor:string):AgentChatScope[]{
 try{const result:AgentChatScope[]=[];
  for(let index=0;index<storage.length;index++){
   const key=storage.key(index);if(!key?.startsWith('agvlog:driver-agent-chat:'))continue;
   const parts=key.split(':');if(parts[3]!==tenant||parts[4]!==actor)continue;
   if(parts.length!==7||parts[2]!=='v1')throw unavailable();
   const scope={driverId:parts[5],agentId:parts[6]};if(pendingChat(storage,tenant,actor,scope))result.push(scope);
  }return result;
 }catch{throw unavailable();}
}
interface Dependencies{storage:Storage;uuid:()=>string;assertContext:()=>void;changed:()=>void;scope?:AgentChatScope;lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;send:(p:ChatCommand)=>PromiseLike<{data:unknown;error:unknown}>}
export function createChatOutbox(deps:Dependencies){
 let inFlight:Promise<ReturnType<typeof parseChatAck>>|null=null;
 const run=(tenant:string,actor:string,input?:ChatInput)=>{
  if(inFlight)return inFlight;
  const work=deps.lock(keyFor(tenant,actor,deps.scope),async()=>{
   deps.assertContext();let row=pendingChat(deps.storage,tenant,actor,deps.scope);const uncertain=!!row;
   if(row&&input)throw new Error('Há uma mensagem pendente. Recupere a confirmação antes de iniciar outra.');
   if(!row){if(!input)throw new Error('Nenhuma mensagem pendente nesta sessão.');
    const payload=chatCommandSchema.parse({...input,version:1,tenant_id:tenant,actor_id:actor,request_id:deps.uuid()});
    if(payload.agent_user_id!==deps.scope?.agentId||(deps.scope&&payload.driver_id!==deps.scope.driverId))throw unavailable();
    row={version:1,tenantId:tenant,actorId:actor,payload};try{deps.storage.setItem(keyFor(tenant,actor,deps.scope),JSON.stringify(row));}catch{throw unavailable();}deps.changed();}
   deps.assertContext();const forget=()=>{try{deps.storage.removeItem(keyFor(tenant,actor,deps.scope));}catch{/* keep exact replay */}deps.changed();};
   const {data,error}=await deps.send(row.payload);deps.assertContext();
   if(error){const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
    if(!uncertain&&(/^(22|23)/.test(code)||['40001','40P01','55P03','42501','55000'].includes(code)))forget();throw error;}
   const ack=parseChatAck(data,row.payload);forget();return ack;
  });inFlight=work;void work.finally(()=>{if(inFlight===work)inFlight=null;deps.changed();}).catch(()=>{});return work;
 };
 return {submit:(tenant:string,actor:string,input:ChatInput)=>run(tenant,actor,input),recover:(tenant:string,actor:string)=>run(tenant,actor)};
}
