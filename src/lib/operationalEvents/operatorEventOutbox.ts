import {isRecord} from '@/lib/loads/operationDocumentOutcome';
import {operationalEventCreateCommandSchema,operationalEventResolveCommandSchema,parseOperationalEventCommandResult,
 type OperationalEventCommand,type OperationalEventCommandAction,type OperationalEventCommandResult,type OperationalEventCreateInput,
 type OperationalEventCreateResult,type OperationalEventResolveInput,type OperationalEventResolveResult} from './operatorEventCommands';

export const OPERATIONAL_EVENT_COMMAND_CHANGED='agvlog:operational-event-command-changed';
const keyFor=(tenant:string,actor:string)=>`agvlog:operational-event-command:v1:${tenant}:${actor}`;
const unavailable=()=>new Error('Recuperação da ocorrência indisponível ou incompatível. Nenhum novo pedido foi enviado.');
export interface PendingOperationalEventCommand{version:1;tenantId:string;actorId:string;createdAt:string;action:OperationalEventCommandAction;payload:OperationalEventCommand}

export function pendingOperationalEventCommand(storage:Storage,tenant:string,actor:string):PendingOperationalEventCommand|null{
 try{
  for(let index=0;index<storage.length;index++){const key=storage.key(index);
   if(key?.startsWith('agvlog:operational-event-command:')&&key.endsWith(`:${tenant}:${actor}`)&&key!==keyFor(tenant,actor))throw unavailable();}
  const raw=storage.getItem(keyFor(tenant,actor));if(!raw)return null;if(raw.length>20_000)throw unavailable();const value:unknown=JSON.parse(raw);
  if(!isRecord(value)||value.version!==1||value.tenantId!==tenant||value.actorId!==actor||!['create','resolve'].includes(String(value.action))
   ||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt)))throw unavailable();
  const action=value.action as OperationalEventCommandAction;
  const payload=action==='create'?operationalEventCreateCommandSchema.parse(value.payload):operationalEventResolveCommandSchema.parse(value.payload);
  if(payload.tenant_id!==tenant||payload.actor_id!==actor)throw unavailable();
  return {...value,action,payload} as PendingOperationalEventCommand;
 }catch{throw unavailable();}
}

interface Dependencies{
 storage:Storage;uuid:()=>string;assertContext:()=>void;changed:()=>void;
 lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;
 send:(action:OperationalEventCommandAction,payload:OperationalEventCommand)=>Promise<{data:unknown;error:unknown}>;
}

export function createOperationalEventOutbox(deps:Dependencies){
 let inFlight:Promise<OperationalEventCommandResult>|null=null;
 const run=(tenant:string,actor:string,action?:OperationalEventCommandAction,input?:OperationalEventCreateInput|OperationalEventResolveInput)=>{
  if(inFlight)return inFlight;const key=keyFor(tenant,actor);const work=deps.lock(key,async()=>{
   deps.assertContext();let row=pendingOperationalEventCommand(deps.storage,tenant,actor);const uncertain=!!row;
   if(row&&action)throw new Error('Há uma ocorrência sem confirmação. Recupere o pedido existente antes de iniciar outro.');
   if(!row){if(!action||!input)throw new Error('Nenhuma solicitação de ocorrência pendente nesta sessão.');
    const base={...input,version:1 as const,tenant_id:tenant,actor_id:actor,request_id:deps.uuid()};
    const payload=action==='create'?operationalEventCreateCommandSchema.parse(base):operationalEventResolveCommandSchema.parse(base);
    row={version:1,tenantId:tenant,actorId:actor,createdAt:new Date().toISOString(),action,payload};
    try{deps.storage.setItem(key,JSON.stringify(row));}catch{throw unavailable();}deps.changed();
   }
   const forget=()=>{try{deps.storage.removeItem(key);}catch{/* Exact replay remains safe. */}deps.changed();};
   deps.assertContext();const {data,error}=await deps.send(row.action,row.payload);deps.assertContext();
   if(error){const code=isRecord(error)?String(error.code??''):'';
    if(!uncertain&&(/^(22|23)/.test(code)||['40001','40P01','55P03','42501','55000'].includes(code)))forget();throw error;}
   const result=row.action==='create'
    ?parseOperationalEventCommandResult(data,'create',row.payload as ReturnType<typeof operationalEventCreateCommandSchema.parse>)
    :parseOperationalEventCommandResult(data,'resolve',row.payload as ReturnType<typeof operationalEventResolveCommandSchema.parse>);
   forget();return result;
  });
  inFlight=work;void work.finally(()=>{if(inFlight===work)inFlight=null;deps.changed();}).catch(()=>{});return work;
 };
 return {
  submitCreate:(tenant:string,actor:string,input:OperationalEventCreateInput)=>run(tenant,actor,'create',input) as Promise<OperationalEventCreateResult>,
  submitResolve:(tenant:string,actor:string,input:OperationalEventResolveInput)=>run(tenant,actor,'resolve',input) as Promise<OperationalEventResolveResult>,
  recover:(tenant:string,actor:string)=>run(tenant,actor),
 };
}
