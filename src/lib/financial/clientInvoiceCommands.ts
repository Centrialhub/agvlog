import {z} from 'zod';
import type {CreateClientInvoicePayload} from '@/hooks/useClientInvoices';
import {isRecord} from '@/lib/loads/operationDocumentOutcome';
const id=z.string().uuid();const revision=z.string().regex(/^[a-f0-9]{32}$/);const cents=z.number().int().nonnegative().max(99999999999999);
export const invoiceAction=z.enum(['generate','generate_closing','mark_sent','cancel','reactivate']);
export type InvoiceAction=z.infer<typeof invoiceAction>;
export const invoiceActionLabels:Record<InvoiceAction,string>={generate:'Gerar fatura',generate_closing:'Faturar fechamento',mark_sent:'Registrar envio',cancel:'Cancelar fatura',reactivate:'Reativar fatura'};
const base={version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,expected_revision:revision,reason:z.string().trim().min(5).max(2000)};
const draftSchema=z.custom<CreateClientInvoicePayload>(value=>isRecord(value)&&typeof value.tenant_id==='string'&&typeof value.client_id==='string'&&typeof value.issue_date==='string'&&Array.isArray(value.charges)&&value.charges.length>0&&value.charges.length<=500);
export const invoiceCommandSchema=z.discriminatedUnion('action',[
 z.object({...base,action:z.literal('generate'),draft:draftSchema}).strict(),
 z.object({...base,action:z.literal('generate_closing'),report_id:id}).strict(),
 z.object({...base,action:z.literal('mark_sent'),invoice_id:id,sent_to:z.string().trim().min(1).max(500),channel:z.string().trim().min(1).max(100)}).strict(),
 z.object({...base,action:z.literal('cancel'),invoice_id:id}).strict(),z.object({...base,action:z.literal('reactivate'),invoice_id:id}).strict(),
]).refine(value=>value.action!=='generate'||value.draft.tenant_id===value.tenant_id,'Empresa da prévia incompatível');
export type InvoiceCommand=z.infer<typeof invoiceCommandSchema>;
type Input<T>=T extends InvoiceCommand?Omit<T,'version'|'tenant_id'|'actor_id'|'request_id'>:never;
export type InvoiceCommandInput=Input<InvoiceCommand>;
const contextSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,invoice_id:id,report_id:id.nullable(),receivable_id:id.nullable(),invoice_number:z.string(),status:z.string(),revision,
 amount_cents:cents,received_cents:cents,open_cents:cents,requires_reconciliation:z.boolean(),can_mark_sent:z.boolean(),can_cancel:z.boolean(),can_reactivate:z.boolean(),
 history:z.array(z.object({id,action:invoiceAction,reason:z.string(),created_at:z.string()}).strict())}).strict();
export type InvoiceActionContext=z.infer<typeof contextSchema>;
export function parseInvoiceContext(value:unknown,tenant:string,actor:string,invoice:string){const parsed=contextSchema.safeParse(value);
 if(!parsed.success||parsed.data.tenant_id!==tenant||parsed.data.actor_id!==actor||parsed.data.invoice_id!==invoice)throw new Error('Contexto da fatura incompatível com a sessão. Atualize antes de confirmar.');return parsed.data;}
const creationSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,mode:z.enum(['generate','generate_closing']),report_id:id.nullable(),client_id:id.nullable(),amount_cents:cents,charge_count:z.number().int().nonnegative(),can_generate:z.boolean(),revision}).strict();
export type InvoiceCreationContext=z.infer<typeof creationSchema>;
export function parseInvoiceCreationContext(value:unknown,tenant:string,actor:string,report:string|null){const parsed=creationSchema.safeParse(value);
 if(!parsed.success||parsed.data.tenant_id!==tenant||parsed.data.actor_id!==actor||parsed.data.report_id!==report||parsed.data.mode!==(report?'generate_closing':'generate'))throw new Error('Prévia de faturamento incompatível com a sessão.');return parsed.data;}
const resultSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,invoice_id:id,report_id:id.nullable(),receivable_id:id,action:invoiceAction,command_id:id,confirmed:z.literal(true),invoice_number:z.string(),status:z.string(),revision}).strict();
export type InvoiceResult=z.infer<typeof resultSchema>;
export function parseInvoiceResult(value:unknown,payload:InvoiceCommand){const parsed=resultSchema.safeParse(value);if(!parsed.success)throw new Error('Fatura sem confirmação compatível. Recupere o mesmo pedido.');const row=parsed.data;
 if(row.tenant_id!==payload.tenant_id||row.actor_id!==payload.actor_id||row.request_id!==payload.request_id||row.action!==payload.action
  ||('invoice_id' in payload&&row.invoice_id!==payload.invoice_id)||(payload.action==='generate_closing'&&row.report_id!==payload.report_id)||(payload.action==='generate'&&row.report_id!==null)
  ||(payload.action==='cancel'&&row.status!=='cancelled')||(payload.action==='mark_sent'&&!['sent','paid'].includes(row.status))
  ||(payload.action==='reactivate'&&!['generated','sent','paid'].includes(row.status))||(payload.action.startsWith('generate')&&row.status!=='generated'))throw new Error('A confirmação não corresponde ao pedido de fatura. Recupere na sessão original.');return row;}
export function invoiceError(cause:unknown){const raw=cause instanceof Error?cause.message:isRecord(cause)?String(cause.message||''):'';
 if(/not_authorized|permission denied/.test(raw))return 'Sua sessão não tem permissão para esta ação de fatura.';
 if(/context_changed|source_changed|concurrent_change/.test(raw))return 'A fatura ou sua origem mudou ou está em uso. Atualize a prévia; recupere primeiro pedidos sem confirmação.';
 if(/already_billed|already_reserved|already_invoiced|duplicate_source|ux_charges/.test(raw))return 'Esta origem já está cobrada ou reservada. Concilie a fatura ou o fechamento existente antes de continuar.';
 if(/requires_reconciliation|valid_state/.test(raw))return 'O estado financeiro exige conferência. Para cancelar, estorne antes todos os recebimentos líquidos; para reativar, confira os vínculos e a origem.';
 if(/invalid_/.test(raw))return 'Confira os valores, a data, o motivo e os dados da fatura.';
 return raw||'Fatura sem confirmação. Recupere o mesmo pedido antes de repetir.';}
