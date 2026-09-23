import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
const id = z.string().uuid(),
  revision = z.string().regex(/^[a-f0-9]{32}$/),
  day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z
  .object({
    version: z.literal(1),
    tenant_id: id,
    actor_id: id,
    receivable_id: id,
    payment_id: id,
    revision,
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(100),
    total: z.number().int().nonnegative(),
    next_offset: z.number().int().nonnegative().nullable(),
    rows: z.array(
      z
        .object({
          id,
          allocation_id: id,
          source_event_id: id,
          agreement_id: id,
          installment_id: id,
          ordinal: z.number().int().positive(),
          due_on: day,
          action: z.enum(["allocate", "reverse"]),
          amount_cents: z.string().regex(/^[1-9]\d*$/),
          created_at: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;
export class ReceivablePaymentInstallmentsChangedError extends Error {
  constructor() {
    super('A distribuição mudou durante a paginação.');
    this.name = 'ReceivablePaymentInstallmentsChangedError';
  }
}
export async function readReceivablePaymentInstallments(
  tenant: string,
  actor: string,
  receivable: string,
  payment: string,
  offset = 0,
  expectedRevision: string | null = null,
) {
  const { data, error } = await (supabase.rpc.bind(supabase) as unknown as Rpc)(
    "get_finance_receivable_payment_installments",
    {
      _tenant_id: tenant,
      _receivable_id: receivable,
      _payment_id: payment,
      _offset: offset,
      _limit: 30,
      _expected_revision: expectedRevision,
    },
  );
  if (error) {
    const candidate = error as { code?: unknown; message?: unknown };
    if (candidate?.code === '40001' || String(candidate?.message ?? '').includes('finance_agreement_history_changed')) {
      throw new ReceivablePaymentInstallmentsChangedError();
    }
    throw error;
  }
  const value = schema.parse(data);
  if (
    value.tenant_id !== tenant ||
    value.actor_id !== actor ||
    value.receivable_id !== receivable ||
    value.payment_id !== payment ||
    value.offset !== offset ||
    (expectedRevision && value.revision !== expectedRevision)
  )
    throw Error("Distribuição de parcelas fora do recebimento solicitado.");
  return value;
}
