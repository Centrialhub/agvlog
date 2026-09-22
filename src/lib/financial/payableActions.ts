import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
const uuid=z.string().uuid();
const base={version:z.literal(1),tenant_id:uuid,request_id:uuid,reason:z.string().trim().min(10).max(2000)};
export const accountPaymentSchema=z.object({...base,payable_id:uuid,bank_account_id:uuid,amount_cents:z.number().int().positive().max(99999999999999),paid_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),method:z.enum(['pix','boleto','ted','doc','dinheiro','cartao','debito_automatico','other']),bank_reference:z.string().trim().max(200)}).strict();
export const archivePayablesSchema=z.object({...base,items:z.array(z.object({payable_id:uuid,revision:z.string().regex(/^[a-f0-9]{32}$/)}).strict()).min(1).max(100)}).strict();
export type AccountPayment=z.infer<typeof accountPaymentSchema>;
export type ArchivePayables=z.infer<typeof archivePayablesSchema>;
export type PayableAction=AccountPayment|ArchivePayables;
export function parsePayableAction(value:unknown):PayableAction{return z.union([accountPaymentSchema,archivePayablesSchema]).parse(value);}
export class PayableActionRejected extends Error {constructor(message:string,readonly code:string){super(message);}}
export async function submitPayableAction(command:PayableAction){
 const parsed=parsePayableAction(command),payment='payable_id' in parsed;
 const rpc=supabase.rpc.bind(supabase) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string;code?:string}|null}>;
 const {data,error}=await rpc(payment?'pay_finance_payable_from_account':'archive_finance_payables',{_payload:parsed});
 if(error){if(['22023','23505','23514','42501','55000','40001'].includes(error.code||''))throw new PayableActionRejected(error.message,error.code!);throw new Error(error.message);}
 const result=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,confirmed:z.literal(true)}).passthrough().parse(data);
 if(result.tenant_id!==parsed.tenant_id||result.request_id!==parsed.request_id)throw new Error('Confirmação fora do pedido original.');
 if(payment){if(result.payable_id!==parsed.payable_id||result.bank_account_id!==parsed.bank_account_id||result.amount_cents!==String(parsed.amount_cents)||result.paid_on!==parsed.paid_on||!uuid.safeParse(result.payment_id).success||!uuid.safeParse(result.movement_id).success)throw new Error('Pagamento confirmado fora da conta ou do título solicitado.');}
 else if(JSON.stringify(z.array(uuid).parse(result.payable_ids).sort())!==JSON.stringify(parsed.items.map(x=>x.payable_id).sort()))throw new Error('Exclusão confirmada fora da seleção.');
 return result;
}
export function payableActionError(error:unknown){
 const message=error instanceof Error?error.message:'';
 if(message.includes('archive_has_payments'))return 'Este título possui pagamentos. Revise as baixas antes de excluir; nenhum título foi excluído.';
 if(message.includes('archive_origin_required')||message.includes('materialization_dependency'))return 'Há vínculos operacionais. Corrija ou cancele o título na origem; nenhum título foi excluído.';
 if(message.includes('changed'))return 'A conta mudou. Atualize a lista e revise novamente.';
 if(message.includes('not_payable'))return 'Aprove o título antes de registrar a baixa.';
 if(message.includes('overpaid'))return 'O valor excede o saldo atual do título. Atualize os dados.';
 if(message.includes('invalid_account'))return 'Selecione uma conta ativa desta empresa.';
 if(message.includes('reference_already_recorded'))return 'Esta referência já está registrada. Use a opção de vincular uma saída existente.';
 if(message.includes('closed'))return 'O título afeta um período fechado. Revise o fechamento antes de continuar.';
 if(message.includes('access_denied'))return 'Você não tem permissão financeira neste contexto.';
 if(error instanceof PayableActionRejected)return 'Operação recusada. Confira a situação e os vínculos do título antes de tentar novamente.';
 return message||'Resposta não confirmada. Retome o mesmo pedido.';
}
