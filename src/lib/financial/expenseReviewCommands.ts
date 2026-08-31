import {z} from 'zod';
import {isRecord} from '@/lib/loads/operationDocumentOutcome';
const id=z.string().uuid(),revision=z.string().regex(/^[a-f0-9]{32}$/);
export const expenseReviewCommandSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,expense_id:id,
 action:z.enum(['approve','reject']),reason:z.string().trim().min(5).max(2000),expected_revision:revision}).strict();
export type ExpenseReviewCommand=z.infer<typeof expenseReviewCommandSchema>;
export type ExpenseReviewInput=Omit<ExpenseReviewCommand,'version'|'tenant_id'|'actor_id'|'request_id'>;
export const rowSchema=z.object({id,tenant_id:id,driver_id:id.nullable(),dispatch_trip_id:id.nullable(),category:z.string(),amount:z.union([z.number(),z.string()]),
 expense_at:z.string(),approval_status:z.string(),notes:z.string().nullable(),receipt_url:z.string().nullable(),no_receipt:z.boolean(),no_receipt_reason:z.string().nullable(),
 payment_source:z.string(),reimbursable:z.boolean(),paid_with_advance:z.boolean(),supplier_name:z.string().nullable(),document_number:z.string().nullable(),
 city:z.string().nullable(),state:z.string().nullable(),odometer:z.number().nullable(),driver_name:z.string().nullable().optional(),review_reason:z.string().nullable().optional()});
export type ReviewExpense=z.infer<typeof rowSchema>;
export const expenseCategoryLabels:Record<string,string>={fuel:'Combustível',food:'Alimentação',toll:'Pedágio',maintenance:'Manutenção',parking:'Estacionamento',other:'Outro'};
export const expensePaymentLabels:Record<string,string>={driver:'Motorista',advance:'Adiantamento',company_card:'Cartão da empresa',company_account:'Conta da empresa',other:'Outro'};
const historySchema=z.object({id,action:z.enum(['approve','reject']),reason:z.string(),created_at:z.string()}).strict();
const contextSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,expense_id:id,status:z.string(),amount_cents:z.number().int().nonnegative().nullable(),
 can_approve:z.boolean(),can_reject:z.boolean(),validation_errors:z.array(z.string()),expense:rowSchema,settlements:z.array(z.object({id,status:z.string(),needs_recalculation:z.boolean(),updated_at:z.string()})),
 revision,history:z.array(historySchema)}).strict();
export type ExpenseReviewContext=z.infer<typeof contextSchema>;
export function parseExpenseReviewContext(value:unknown,tenant:string,actor:string,expense:string){const parsed=contextSchema.safeParse(value);
 if(!parsed.success||parsed.data.tenant_id!==tenant||parsed.data.actor_id!==actor||parsed.data.expense_id!==expense||parsed.data.expense.id!==expense||parsed.data.expense.tenant_id!==tenant)
  throw new Error('Contexto de despesa incompatível com a sessão. Atualize a consulta.');return parsed.data;}
const listSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,can_review:z.boolean(),filter:z.enum(['pending','reviewed']),offset:z.number().int().nonnegative(),total:z.number().int().nonnegative(),rows:z.array(rowSchema).max(50)}).strict();
export function parseExpenseReviewList(value:unknown,tenant:string,actor:string,filter:string,offset:number){const parsed=listSchema.safeParse(value);
 if(!parsed.success||parsed.data.tenant_id!==tenant||parsed.data.actor_id!==actor||parsed.data.filter!==filter||parsed.data.offset!==offset||parsed.data.rows.some(row=>row.tenant_id!==tenant))
  throw new Error('Lista de despesas incompatível com a sessão. Atualize a consulta.');return parsed.data;}
const resultSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,expense_id:id,command_id:id,action:z.enum(['approve','reject']),status:z.enum(['approved','rejected']),confirmed:z.literal(true),revision}).strict();
export type ExpenseReviewResult=z.infer<typeof resultSchema>;
export function parseExpenseReviewResult(value:unknown,payload:ExpenseReviewCommand){const parsed=resultSchema.safeParse(value);if(!parsed.success)throw new Error('Revisão sem confirmação compatível. Recupere o mesmo pedido.');const result=parsed.data;
 if(result.tenant_id!==payload.tenant_id||result.actor_id!==payload.actor_id||result.request_id!==payload.request_id||result.expense_id!==payload.expense_id||result.action!==payload.action
  ||result.status!==(payload.action==='approve'?'approved':'rejected'))throw new Error('A confirmação não corresponde à revisão. Recupere o pedido na sessão original.');return result;}
export const expenseValidationLabels:Record<string,string>={amount:'Valor inválido ou com fração de centavo.',category:'Categoria não informada.',date:'Data da despesa inválida.',scope:'Motorista ou viagem fora do escopo da empresa.',
 payment_source:'Origem do pagamento, reembolso e adiantamento divergentes.',receipt:'Comprovante ausente/incompatível ou justificativa insuficiente.',existing_obligation:'Já existe uma obrigação financeira; é necessária conciliação.'};
export function expenseReviewError(cause:unknown){const message=cause instanceof Error?cause.message:isRecord(cause)?String(cause.message??''):'';
 if(/not_authorized|permission denied/.test(message))return 'Sua sessão não tem permissão para revisar esta despesa.';
 if(/context_changed|concurrent_change/.test(message))return 'A despesa ou o acerto mudou ou está em uso. Atualize a revisão antes de confirmar.';
 if(/requires_reconciliation|existing_obligation/.test(message))return 'A despesa exige conferência dos dados ou conciliação financeira antes desta ação.';
 if(/invalid_|key_mismatch|ack_required/.test(message))return 'Pedido de revisão inválido ou incompatível. Confira o motivo e recupere pedidos sem confirmação.';
 return message||'Revisão sem confirmação. Recupere o mesmo pedido antes de repetir.';}
export function expenseAmount(amount:number|string){const value=Number(amount);return Number.isFinite(value)?value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'Valor a conferir';}
