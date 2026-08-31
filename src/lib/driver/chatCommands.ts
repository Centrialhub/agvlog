import {z} from 'zod';
const id=z.string().uuid(),date=z.string().datetime({offset:true});
export const chatCommandSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,driver_id:id.nullable(),event_id:id.optional(),request_id:id,expected_revision:z.string().regex(/^[a-f0-9]{32}$/),
 message:z.string().min(1).max(4000).refine(text=>text===text.trim(),'Revise o texto da mensagem.')}).strict().refine(p=>!!p.event_id||!!p.driver_id,'Conversa não identificada.');
export type ChatCommand=z.infer<typeof chatCommandSchema>;
export type ChatInput=Pick<ChatCommand,'driver_id'|'event_id'|'expected_revision'|'message'>;
const contextSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,driver_id:id.nullable(),event_id:id.optional(),audience:z.enum(['driver','operation']).optional(),driver_name:z.string(),conversation_user_id:id.nullable(),
 sender_role:z.enum(['owner','admin','operator','driver']),sender_name:z.string(),can_send:z.boolean(),revision:z.string().regex(/^[a-f0-9]{32}$/)}).strict();
export type ChatContext=z.infer<typeof contextSchema>;
const rowSchema=z.object({id,tenant_id:id,driver_id:id.nullable(),event_id:id.optional(),sender_id:id.nullable(),sender_role:z.string(),sender_name:z.string().nullable(),message:z.string(),created_at:date,
 request_id:id.nullable(),conversation_user_id:id.nullable(),verified_sender:z.boolean(),has_legacy_attachment:z.boolean()}).strict();
export type ChatMessage=z.infer<typeof rowSchema>;
const cursorSchema=z.object({id,created_at:date}).strict();
export type ChatCursor=z.infer<typeof cursorSchema>;
const pageSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,driver_id:id.nullable(),event_id:id.optional(),messages:z.array(rowSchema).max(50),next_cursor:cursorSchema.nullable()}).strict();
const ackSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,driver_id:id.nullable(),event_id:id.optional(),request_id:id,confirmed:z.literal(true),message:rowSchema}).strict();
function scope(value:{tenant_id:string;actor_id:string;driver_id:string|null;event_id?:string},tenant:string,actor:string,driver:string|null,event?:string){
 if(value.tenant_id!==tenant||value.actor_id!==actor||value.event_id!==event||(!event&&(!driver||value.driver_id!==driver)))throw new Error('Resposta do chat incompatível com a sessão ou conversa.');
}
export function parseChatContext(value:unknown,tenant:string,actor:string,driver:string|null,event?:string){const c=contextSchema.parse(value);scope(c,tenant,actor,driver,event);if(event&&c.audience!==(c.driver_id?'driver':'operation'))throw new Error('Destinatário da conversa incompatível.');return c;}
export function parseChatPage(value:unknown,tenant:string,actor:string,driver:string|null,event?:string){
 const p=pageSchema.parse(value);scope(p,tenant,actor,driver,event);
 if(p.messages.some(m=>m.tenant_id!==tenant||m.event_id!==event||(!event&&m.driver_id!==driver))||new Set(p.messages.map(m=>m.id)).size!==p.messages.length)throw new Error('Mensagens fora do escopo da conversa.');
 const last=p.messages.at(-1);if(p.next_cursor&&(!last||p.next_cursor.id!==last.id||p.next_cursor.created_at!==last.created_at))throw new Error('Paginação do chat incompatível. Atualize a conversa.');return p;
}
export function parseChatAck(value:unknown,p:ChatCommand){
 const a=ackSchema.parse(value);scope(a,p.tenant_id,p.actor_id,p.driver_id,p.event_id);
 if(a.request_id!==p.request_id||a.message.request_id!==p.request_id||a.message.sender_id!==p.actor_id||a.message.tenant_id!==p.tenant_id||a.message.driver_id!==p.driver_id
  ||a.driver_id!==p.driver_id||a.message.event_id!==p.event_id||a.message.message!==p.message||!a.message.verified_sender||(!a.message.conversation_user_id&&(!p.event_id||p.driver_id!==null))||!['owner','admin','operator','driver'].includes(a.message.sender_role))
  throw new Error('Mensagem sem confirmação compatível. Recupere o mesmo pedido.');return a;
}
export function chatError(cause:unknown){
 if(cause instanceof z.ZodError)return 'Dados do chat incompatíveis. Atualize a conversa antes de enviar.';
 const message=cause instanceof Error?cause.message:typeof cause==='object'&&cause!==null&&'message' in cause?String(cause.message):'';
 if(/mfa_required/.test(message))return 'Confirme a autenticação em duas etapas para acessar o chat.';
 if(/not_authorized|permission denied/.test(message))return 'Sua sessão não tem acesso a esta conversa.';
 if(/context_changed|concurrent_change/.test(message))return 'A conversa mudou ou está em uso. Atualize o contexto antes de enviar.';
 if(/event_chat_invalid_binding/.test(message))return 'Os vínculos da ocorrência precisam ser conferidos pela operação antes de enviar.';
 if(/recipient_unavailable/.test(message))return 'O motorista não possui um acesso ativo para receber mensagens.';
 if(/invalid_message/.test(message))return 'Escreva uma mensagem de até 4.000 caracteres.';
 return message||'Mensagem sem confirmação. Recupere o mesmo pedido antes de reenviar.';
}
