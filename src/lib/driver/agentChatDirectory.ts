import {z} from 'zod';
const id=z.string().guid(),date=z.string().datetime({offset:true});
const cursor=z.object({id,created_at:date}).strict();
const contact=z.object({user_id:id,name:z.string(),active:z.boolean(),role:z.enum(['owner','admin','operator','history']),
 last_message_id:id.nullable(),last_created_at:date.nullable(),last_message:z.string().nullable(),last_sender_id:id.nullable()}).strict();
const contacts=z.object({version:z.literal(1),tenant_id:id,actor_id:id,driver_id:id,contacts:z.array(contact)}).strict();
const thread=z.object({id,driver_id:id,driver_name:z.string(),created_at:date,message:z.string(),sender_id:id}).strict();
const inbox=z.object({version:z.literal(1),tenant_id:id,actor_id:id,threads:z.array(thread).max(50),next_cursor:cursor.nullable()}).strict();
export type AgentChatContact=z.infer<typeof contact>;
export function parseAgentContacts(value:unknown,tenant:string,actor:string,driver:string){
 const p=contacts.parse(value);
 if(p.tenant_id!==tenant||p.actor_id!==actor||p.driver_id!==driver||new Set(p.contacts.map(c=>c.user_id)).size!==p.contacts.length)
  throw new Error('Atendentes fora do contexto da conversa.');return p;
}
export function parseAgentInbox(value:unknown,tenant:string,actor:string){
 const p=inbox.parse(value),last=p.threads.at(-1);
 if(p.tenant_id!==tenant||p.actor_id!==actor||new Set(p.threads.map(t=>t.driver_id)).size!==p.threads.length
  ||p.next_cursor&&(!last||p.next_cursor.id!==last.id||p.next_cursor.created_at!==last.created_at))throw new Error('Caixa de conversas fora do contexto atual.');return p;
}
