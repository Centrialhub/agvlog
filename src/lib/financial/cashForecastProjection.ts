import { z } from 'zod';

const cents = z.string().regex(/^(0|[1-9]\d{0,13})$/);
const signed = z.string().regex(/^-?(0|[1-9]\d{0,17})$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const captureDay = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : '';
const origin = z.object({
  economic_key: z.string().min(1).max(250),
  source_table: z.string().min(1).max(100), source_id: z.string().uuid(),
  source_revision: z.string().min(1).max(128),
  direction: z.enum(['in', 'out']), scenario: z.enum(['confirmed', 'unbilled']),
  nominal_cents: cents, fulfilled_cents: cents, reserved_credit_cents: cents,
  expected_on: day.nullable(), expected_date_source: z.enum(['due_date', 'reviewed_date', 'unknown']),
}).strict().superRefine((row, ctx) => {
  if (BigInt(row.fulfilled_cents) + BigInt(row.reserved_credit_cents) > BigInt(row.nominal_cents))
    ctx.addIssue({ code: 'custom', message: 'Recebimentos, pagamentos e créditos excedem a origem.' });
  if ((row.expected_on === null) !== (row.expected_date_source === 'unknown'))
    ctx.addIssue({ code: 'custom', message: 'A previsão da data exige sua origem.' });
  if (row.scenario === 'unbilled' && row.direction !== 'in')
    ctx.addIssue({ code: 'custom', message: 'Frete a faturar deve representar expectativa de entrada.' });
});

/** Input must be collected and authorized by the server; this calculator is not evidence validation. */
export const cashForecastBasisSchema = z.object({
  version: z.literal(1), tenant_id: z.string().uuid(),
  account_ids: z.array(z.string().uuid()).min(1),
  captured_at: z.string().datetime({ offset: true }), cutoff: day, period_end: day,
  base: z.object({ amount_cents: signed.nullable(), as_of: day,
    source_id: z.string().uuid(), source_revision: z.string().min(1).max(128),
    confirmation: z.enum(['bank_confirmed', 'cash_count', 'provisional', 'unverified']),
  }).strict(),
  origins: z.array(origin),
  recorded_after_cutoff: z.array(z.object({
    movement_id: z.string().uuid(), account_id: z.string().uuid(), source_revision: z.string().min(1),
    occurred_on: day, direction: z.enum(['in', 'out']), amount_cents: cents.refine(value => BigInt(value) > 0n),
    confirmation: z.enum(['bank_confirmed', 'recorded']),
  }).strict()),
  // Unattributed credit cannot be subtracted from a particular title by guesswork.
  unassigned_credit_cents: cents,
  source_issues: z.array(z.object({ code: z.string().min(1), source_ids: z.array(z.string().uuid()) }).strict()),
}).strict().superRefine((basis, ctx) => {
  if (basis.cutoff >= basis.period_end || basis.base.as_of !== basis.cutoff)
    ctx.addIssue({ code: 'custom', message: 'A projeção deve começar após a data do saldo-base.' });
  if (new Set(basis.account_ids).size !== basis.account_ids.length)
    ctx.addIssue({ code: 'custom', message: 'Conta repetida no escopo da previsão.' });
  if (new Set(basis.origins.map(row => row.economic_key)).size !== basis.origins.length
    || new Set(basis.origins.map(row => `${row.source_table}:${row.source_id}`)).size !== basis.origins.length)
    ctx.addIssue({ code: 'custom', message: 'A mesma origem econômica aparece mais de uma vez.' });
  const capturedDay = captureDay(basis.captured_at);
  if (basis.cutoff >= capturedDay || basis.period_end < capturedDay)
    ctx.addIssue({ code: 'custom', message: 'A base deve anteceder a captura e o horizonte deve incluir sua data.' });
  if (new Set(basis.recorded_after_cutoff.map(row => row.movement_id)).size !== basis.recorded_after_cutoff.length
    || basis.recorded_after_cutoff.some(row => !basis.account_ids.includes(row.account_id) || row.occurred_on <= basis.cutoff || row.occurred_on > capturedDay))
    ctx.addIssue({ code: 'custom', message: 'Movimento repetido ou fora do escopo entre a base e a captura.' });
  if ((basis.base.amount_cents === null) !== (basis.base.confirmation === 'unverified'))
    ctx.addIssue({ code: 'custom', message: 'Saldo-base indeterminado exige diagnóstico.' });
});
export type CashForecastBasis = z.infer<typeof cashForecastBasisSchema>;

/** Pure projection: never changes source rows, reserves credit, or records cash. */
export function projectCashForecast(input: CashForecastBasis) {
  const basis = cashForecastBasisSchema.parse(input);
  const capturedDay = captureDay(basis.captured_at);
  let incoming = 0n, outgoing = 0n, unbilled = 0n;
  const recorded = basis.recorded_after_cutoff.reduce((total, row) => {
    total[row.direction] += BigInt(row.amount_cents); return total;
  }, { in: 0n, out: 0n });
  let unscheduledConfirmed = 0n, unscheduledUnbilled = 0n;
  const rows = basis.origins.map(row => {
    const remaining = BigInt(row.nominal_cents) - BigInt(row.fulfilled_cents) - BigInt(row.reserved_credit_cents);
    const timing = remaining === 0n ? 'already_covered'
      : row.expected_on === null || row.expected_on < capturedDay ? 'needs_new_date'
      : row.expected_on > basis.period_end ? 'after_period' : 'in_period';
    if (timing === 'in_period') {
      if (row.scenario === 'unbilled') unbilled += remaining;
      else if (row.direction === 'in') incoming += remaining;
      else outgoing += remaining;
    }
    if (timing === 'needs_new_date') {
      if (row.scenario === 'unbilled') unscheduledUnbilled += remaining;
      else unscheduledConfirmed += remaining;
    }
    return { ...row, remaining_cents: remaining.toString(), timing };
  });
  const issues = [...basis.source_issues];
  if (BigInt(basis.unassigned_credit_cents) > 0n) issues.push({ code: 'unassigned_customer_credit', source_ids: [] });
  if (basis.base.amount_cents === null) issues.push({ code: 'base_balance_unverified', source_ids: [basis.base.source_id] });
  const confirmedComplete = issues.length === 0 && unscheduledConfirmed === 0n;
  const expandedComplete = confirmedComplete && unscheduledUnbilled === 0n;
  const baseAmount = basis.base.amount_cents === null ? null : BigInt(basis.base.amount_cents);
  return {
    version: 1 as const, tenant_id: basis.tenant_id, account_ids: [...basis.account_ids],
    captured_at: basis.captured_at, cutoff: basis.cutoff, period_end: basis.period_end, base: { ...basis.base },
    recorded_after_cutoff: basis.recorded_after_cutoff,
    recorded_totals: { in_cents: recorded.in.toString(), out_cents: recorded.out.toString() },
    rows, issues, unassigned_credit_cents: basis.unassigned_credit_cents,
    scheduled: { confirmed_in_cents: incoming.toString(), confirmed_out_cents: outgoing.toString(), unbilled_in_cents: unbilled.toString() },
    unscheduled: { confirmed_cents: unscheduledConfirmed.toString(), unbilled_cents: unscheduledUnbilled.toString() },
    confirmed: { complete: confirmedComplete, closing_cents: confirmedComplete && baseAmount !== null ? (baseAmount + recorded.in - recorded.out + incoming - outgoing).toString() : null },
    expanded: { complete: expandedComplete, closing_cents: expandedComplete && baseAmount !== null ? (baseAmount + recorded.in - recorded.out + incoming + unbilled - outgoing).toString() : null },
  };
}
