import {movementUseError} from './movementUseErrors';
import { z } from 'zod';

export const movementNatures = {
  driver_advance: 'Envio ao motorista', payment: 'Pagamento', receipt: 'Recebimento',
  transfer: 'Transferência', refund: 'Devolução', customer_advance: 'Adiantamento de cliente', other: 'Outra movimentação',
} as const;
export const movementCorrectionSchema=z.object({id:z.string().uuid(),tenant_id:z.string().uuid(),movement_id:z.string().uuid(),original_request_id:z.string().uuid(),request_id:z.string().uuid(),kind:z.enum(['void','duplicate','replacement']),duplicate_of_movement_id:z.string().uuid().nullable(),replacement_movement_id:z.string().uuid().nullable(),actor_id:z.string().uuid(),actor_name:z.string(),reason:z.string(),revision:z.string().regex(/^[a-f0-9]{32}$/),created_at:z.string()}).superRefine((v,c)=>{if((v.kind==='void'&&(v.duplicate_of_movement_id!==null||v.replacement_movement_id!==null))||(v.kind==='duplicate'&&(!v.duplicate_of_movement_id||v.replacement_movement_id!==null))||(v.kind==='replacement'&&(!v.replacement_movement_id||v.duplicate_of_movement_id!==null))||v.movement_id===v.duplicate_of_movement_id||v.movement_id===v.replacement_movement_id)c.addIssue({code:'custom',message:'Referências da correção inconsistentes.'});});
export const movementSchema = z.object({
  voided:z.boolean(),correction:movementCorrectionSchema.nullable(),
  id: z.string().uuid(), tenant_id: z.string().uuid(), bank_account_id: z.string().uuid(), account_name: z.string(),
  direction: z.enum(['in', 'out']), nature: z.enum(['driver_advance', 'payment', 'receipt', 'transfer', 'refund', 'customer_advance', 'other']),
  amount_cents: z.number().int().positive().max(99999999999999), occurred_on: z.string(),
  description: z.string(), beneficiary_name: z.string(), beneficiary_document: z.string().nullable(),
  driver_id: z.string().uuid().nullable(), bank_reference: z.string().nullable(), receipt_path: z.string().nullable(),
  created_by: z.string().uuid(), created_at: z.string(),
}).superRefine((v,c)=>{if(v.voided!==(v.correction!==null)||(v.correction&&(v.correction.movement_id!==v.id||v.correction.tenant_id!==v.tenant_id)))c.addIssue({code:'custom',message:'Situação da movimentação inconsistente.'});});
export const movementListSchema = z.object({
  version: z.literal(1), tenant_id: z.string().uuid(), page: z.number().int().positive(),
  page_size: z.number().int().positive().max(100), total: z.number().int().nonnegative(),
  active_count:z.number().int().nonnegative(),voided_count:z.number().int().nonnegative(),historical_inflow_cents:z.string().regex(/^\d+$/),historical_outflow_cents:z.string().regex(/^\d+$/),voided_inflow_cents:z.string().regex(/^\d+$/),voided_outflow_cents:z.string().regex(/^\d+$/),
  inflow_cents: z.string().regex(/^\d+$/), outflow_cents: z.string().regex(/^\d+$/), rows: z.array(movementSchema),
}).superRefine((v,c)=>{if(v.total!==v.active_count+v.voided_count||BigInt(v.historical_inflow_cents)!==BigInt(v.inflow_cents)+BigInt(v.voided_inflow_cents)||BigInt(v.historical_outflow_cents)!==BigInt(v.outflow_cents)+BigInt(v.voided_outflow_cents)||v.rows.some(row=>row.tenant_id!==v.tenant_id))c.addIssue({code:'custom',message:'Totais ativos e históricos inconsistentes.'});});
export const movementResultSchema = z.object({
  version: z.literal(1), tenant_id: z.string().uuid(), request_id: z.string().uuid(),
  movement_id: z.string().uuid(), confirmed: z.literal(true),
});
export type Movement = z.infer<typeof movementSchema>;
export interface MovementFilters { page: number; page_size: number; search: string; from: string; to: string; direction: string; account_id: string }
export interface MovementCommand {
  version: 1; tenant_id: string; request_id: string; bank_account_id: string;
  direction: 'in' | 'out'; nature: keyof typeof movementNatures; amount_cents: number; occurred_on: string;
  description: string; beneficiary_name: string; beneficiary_document?: string;
  driver_id?: string; bank_reference?: string; receipt_path?: string; reason: string;
}
export function parseFinanceAmount(value: string): number | null {
  const raw = value.trim().replace(/^R\$\s*/, '');
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(raw)) return null;
  const [integer, fraction = ''] = raw.replace(/\./g, '').split(',');
  const amount = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'));
  return amount > 0n && amount <= 99999999999999n ? Number(amount) : null;
}
export function formatFinanceCents(value: string | number): string {
  const cents = BigInt(value), absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}R$ ${(absolute / 100n).toLocaleString('pt-BR')},${String(absolute % 100n).padStart(2, '0')}`;
}
export function financeError(error: unknown): string {
  const movementError=movementUseError(error);if(movementError)return movementError;
  const raw = error instanceof Error ? error.message : '';
  if (raw.includes('finance_account_period_closed') || raw.includes('finance_period_closed')) return 'O lançamento afeta um período fechado. Consulte o histórico e solicite a reabertura ao administrador para corrigir o registro.';
  if (raw.includes('access_denied')) return 'Acesso financeiro não permitido para este usuário.';
  if (raw.includes('reference_already_recorded')) return 'Esta referência bancária já foi registrada. Confira o envio existente.';
  if (raw.includes('request_conflict')) return 'O pedido já foi usado com outros dados. Confira o registro antes de tentar novamente.';
  if (raw.includes('invalid_account')) return 'Selecione uma conta ativa desta empresa.';
  if (raw.includes('invalid_driver')) return 'Selecione um motorista ativo desta empresa.';
  if (raw.includes('invalid_cost_center')) return 'Selecione um centro de custo ativo desta empresa e revise a despesa.';
  if (raw.includes('movement_overallocated')) return 'O envio já foi usado em outros gastos. Atualize sua seleção e revise os valores vinculados.';
  if (raw.includes('expense_overallocated')) return 'O valor vinculado supera o gasto. Corrija os vínculos.';
  if (raw.includes('trip_not_completed')) return 'Selecione uma viagem finalizada para conferir os gastos do retorno.';
  if (raw.includes('delivery_already_charged')) return 'Esta entrega já possui uma descarga registrada. Confira o lançamento existente.';
  if (raw.includes('delivery_changed')) return 'A composição da entrega mudou. Selecione novamente a entrega e revise o fornecedor.';
  if (raw.includes('receipt_not_found') || raw.includes('invalid_receipt')) return 'O comprovante não pôde ser validado. Anexe novamente o arquivo correto.';
  return 'Não foi possível confirmar a operação. Os dados foram preservados; tente consultar ou reenviar o mesmo pedido.';
}
