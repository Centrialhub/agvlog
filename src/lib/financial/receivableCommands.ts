import {z} from 'zod';
const id=z.string().uuid();const revision=z.string().regex(/^[a-f0-9]{32}$/);const cents=z.number().int().nonnegative().max(99999999999999);
export const financialAction=z.enum(['receive','reverse','reconcile']);
export type FinancialAction=z.infer<typeof financialAction>;
export const financialActionLabels:Record<FinancialAction,string>={receive:'Registrar recebimento',reverse:'Estornar recebimento',reconcile:'Conciliar projeções'};
const base={version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,receivable_id:id,expected_revision:revision,reason:z.string().trim().min(5).max(2000)};
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const financialCommandSchema=z.discriminatedUnion('action',[
 z.object({...base,action:z.literal('receive'),amount_cents:cents.positive(),effective_date:date,bank_account_id:id,
  method:z.enum(['pix','boleto','ted','doc','dinheiro','cartao','debito_automatico','other']),notes:z.string().max(2000).nullable().optional(),attachment_path:z.string().max(1000).nullable().optional()}).strict(),
 z.object({...base,action:z.literal('reverse'),effective_date:date,payment_id:id}).strict(),
 z.object({...base,action:z.literal('reconcile')}).strict(),
]);
export type FinancialCommand=z.infer<typeof financialCommandSchema>;
type Input<T>=T extends FinancialCommand?Omit<T,'version'|'tenant_id'|'actor_id'|'request_id'>:never;
export type FinancialCommandInput=Input<FinancialCommand>;
const contextSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,receivable_id:id,invoice_id:id.nullable(),report_id:id.nullable(),reference:z.string(),revision,
 status:z.string(),amount_cents:cents.positive(),received_cents:cents,open_cents:cents,requires_reconciliation:z.boolean(),reconciliation_reason:z.string().nullable(),
 can_receive:z.boolean(),can_reverse:z.boolean(),can_reconcile:z.boolean(),history_complete:z.boolean(),payment_count:z.number().int().nonnegative(),
 bank_accounts:z.array(z.object({id,name:z.string()}).strict()),payments:z.array(z.object({id,amount_cents:cents.positive(),received_at:z.string(),method:z.string().nullable(),notes:z.string().nullable(),
  bank_account_id:id.nullable(),bank_account_name:z.string().nullable(),attachment_path:z.string().nullable(),reversed_at:z.string().nullable(),reversal_reason:z.string().nullable()}).strict())}).strict();
export type FinancialContext=z.infer<typeof contextSchema>;
export function parseFinancialContext(value:unknown,tenant:string,actor:string,receivable:string){
 const parsed=contextSchema.safeParse(value);if(!parsed.success)throw new Error('Contexto financeiro incompatível. Atualize antes de confirmar.');const row=parsed.data;
 if(row.tenant_id!==tenant||row.actor_id!==actor||row.receivable_id!==receivable||(!row.requires_reconciliation&&(row.status==='cancelled'?row.received_cents!==0||row.open_cents!==0:row.received_cents+row.open_cents!==row.amount_cents)))
  throw new Error('Contexto financeiro incompatível com a sessão.');return row;
}
const resultSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,receivable_id:id,action:financialAction,confirmed:z.literal(true),command_id:id,
 payment_id:id.nullable(),reversal_id:id.nullable(),bank_transaction_id:id.nullable(),revision,received_cents:cents,open_cents:cents,report_id:id.nullable(),invoice_id:id.nullable()}).strict();
export type FinancialResult=z.infer<typeof resultSchema>;
export function parseFinancialResult(value:unknown,payload:FinancialCommand){
 const parsed=resultSchema.safeParse(value);if(!parsed.success)throw new Error('Operação sem confirmação compatível. Recupere o mesmo pedido.');const row=parsed.data;
 if(row.tenant_id!==payload.tenant_id||row.actor_id!==payload.actor_id||row.receivable_id!==payload.receivable_id||row.request_id!==payload.request_id||row.action!==payload.action
  ||(payload.action==='receive'&&(!row.payment_id||!row.bank_transaction_id||row.reversal_id!==null||row.received_cents<payload.amount_cents))
  ||(payload.action==='reverse'&&(row.payment_id!==payload.payment_id||!row.reversal_id||!row.bank_transaction_id))
  ||(payload.action==='reconcile'&&(row.payment_id!==null||row.reversal_id!==null||row.bank_transaction_id!==null)))
  throw new Error('A confirmação não corresponde à operação. Recupere o pedido na sessão original.');return row;
}
export function parseMoneyCents(raw:string){
 const value=raw.trim();if(!/^\d+(?:[.,]\d{1,2})?$/.test(value))throw new Error('Informe o valor sem separador de milhar, com até duas casas decimais.');
 const [whole,fraction='']=value.replace(',','.').split('.');const amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(amount)||amount<=0||amount>99999999999999)throw new Error('Informe um valor positivo válido.');return amount;
}
export function financialError(cause:unknown){
 const raw=cause instanceof Error?cause.message:typeof cause==='object'&&cause!==null&&'message' in cause?String(cause.message):'';
 if(/context_changed|concurrent_change/.test(raw))return 'O título mudou ou está em uso. Atualize o estado; recupere primeiro qualquer pedido sem confirmação.';
 if(/not_authorized|permission denied/.test(raw))return 'Sua sessão não tem permissão para esta operação financeira.';
 if(/requires_reconciliation/.test(raw))return 'O histórico e as projeções financeiras divergem. É necessária uma conciliação explícita antes de registrar valores.';
 if(/invalid_state/.test(raw))return 'Operação indisponível no estado atual. Atualize e confira a conciliação.';
 if(/overpayment/.test(raw))return 'O recebimento excede o saldo em aberto. Atualize o título.';
 if(/invalid_bank_account/.test(raw))return 'Selecione uma conta bancária ativa da empresa atual.';
 if(/attachment/.test(raw))return 'O comprovante não foi validado nesta empresa. Confira o arquivo antes de reenviar.';
 if(/invalid_|key_mismatch/.test(raw))return 'Confira o valor, a data, o motivo e os dados da operação.';
 return raw||'Operação sem confirmação. Recupere o mesmo pedido antes de repetir.';
}
