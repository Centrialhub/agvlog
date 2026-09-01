import { z } from 'zod';
import { parseMoneyCents } from '@/lib/financial/receivableCommands';

const id = z.string().uuid();
const cents = z.number().int().positive().max(99999999999999);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const loadPaymentCommandSchema = z.object({
  version: z.literal(1),
  tenant_id: id,
  actor_id: id,
  request_id: id,
  load_id: id,
  receivable_id: id,
  amount_cents: cents,
  effective_date: date,
  bank_account_id: id,
  method: z.enum(['pix', 'boleto', 'ted', 'doc', 'dinheiro', 'cartao', 'debito_automatico', 'other']),
  notes: z.string().max(2000).nullable().optional(),
}).strict();

export type LoadPaymentCommand = z.infer<typeof loadPaymentCommandSchema>;
export type LoadPaymentCommandInput = Omit<LoadPaymentCommand, 'version' | 'tenant_id' | 'actor_id' | 'request_id'>;

const resultSchema = z.object({
  version: z.literal(1),
  tenant_id: id,
  actor_id: id,
  request_id: id,
  load_id: id,
  receivable_id: id,
  confirmed: z.literal(true),
  command_id: id,
  financial_command_id: id,
  load_payment_id: id,
  receivable_payment_id: id,
  bank_transaction_id: id,
  amount_cents: cents,
  received_cents: z.number().int().nonnegative().max(99999999999999),
  open_cents: z.number().int().nonnegative().max(99999999999999),
  payment_status: z.enum(['unpaid', 'partially_paid', 'paid', 'overdue']),
  load_version: z.number().int().positive(),
}).strict();

export type LoadPaymentResult = z.infer<typeof resultSchema>;

export function parseLoadPaymentResult(value: unknown, payload: LoadPaymentCommand): LoadPaymentResult {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw new Error('Pagamento sem confirmação compatível. Recupere o mesmo pedido.');
  const result = parsed.data;
  if (result.tenant_id !== payload.tenant_id || result.actor_id !== payload.actor_id
      || result.request_id !== payload.request_id || result.load_id !== payload.load_id
      || result.receivable_id !== payload.receivable_id || result.amount_cents !== payload.amount_cents
      || result.received_cents < payload.amount_cents) {
    throw new Error('A confirmação não corresponde ao pagamento. Recupere o pedido na sessão original.');
  }
  return result;
}

export { parseMoneyCents };

export function loadPaymentError(cause: unknown): string {
  const raw = cause instanceof Error
    ? cause.message
    : typeof cause === 'object' && cause !== null && 'message' in cause
      ? String(cause.message)
      : '';
  if (/concurrent_change/.test(raw)) return 'A carga ou o título está em uso. Aguarde, atualize e tente novamente.';
  if (/not_authorized|permission denied/.test(raw)) return 'Sua sessão não tem permissão para registrar pagamentos nesta empresa.';
  if (/requires_reconciliation/.test(raw)) return 'A carga e o recebível estão divergentes. Concilie os saldos antes de registrar outro pagamento.';
  if (/invalid_receivable_link|load_not_found/.test(raw)) return 'A carga não possui um recebível válido da empresa atual.';
  if (/invalid_bank_account/.test(raw)) return 'Selecione uma conta bancária ativa da empresa atual.';
  if (/cancelled_load/.test(raw)) return 'Carga cancelada não pode receber pagamento.';
  if (/amount_exceeds_open_balance/.test(raw)) return 'O pagamento excede o saldo em aberto. Atualize a carga.';
  if (/invalid_date/.test(raw)) return 'Informe uma data válida, sem usar data futura.';
  if (/invalid_command|request_key_mismatch/.test(raw)) return 'Confira o valor, a data e os dados do pagamento.';
  return raw || 'Pagamento sem confirmação. Recupere o mesmo pedido antes de repetir.';
}
