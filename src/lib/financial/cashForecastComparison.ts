import { periodMoneyPackageSchema } from './periodMoneyPackageContract';
import type { projectCashForecast } from './cashForecastProjection';

type Projection = ReturnType<typeof projectCashForecast>;
/** Compare a preserved projection, never reconstruct it from today's commercial balances. */
export function compareCashForecast(original: Projection, realizedInput: unknown) {
  const realized = periodMoneyPackageSchema.parse(realizedInput);
  const start = new Date(`${original.cutoff}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 1);
  const sameAccounts = original.account_ids.length === realized.account_scope.selected_ids.length
    && new Set(original.account_ids).size === original.account_ids.length
    && original.account_ids.every(id => realized.account_scope.selected_ids.includes(id));
  if (original.tenant_id !== realized.tenant_id || !sameAccounts
    || start.toISOString().slice(0, 10) !== realized.period.from || original.period_end !== realized.period.to)
    throw new Error('Previsão e realizado precisam pertencer à mesma empresa, contas e período.');
  const compare = (expanded: boolean) => {
    const scenario = expanded ? original.expanded : original.confirmed;
    if (!realized.monetary_totals_valid || !scenario.complete || scenario.closing_cents === null || original.base.amount_cents === null)
      return { available: false as const, matches: false, expected: null, actual: null, differences: null };
    const expectedIn = BigInt(original.recorded_totals.in_cents) + BigInt(original.scheduled.confirmed_in_cents)
      + (expanded ? BigInt(original.scheduled.unbilled_in_cents) : 0n);
    const expectedOut = BigInt(original.recorded_totals.out_cents) + BigInt(original.scheduled.confirmed_out_cents);
    const expectedClosing = BigInt(scenario.closing_cents);
    if (BigInt(original.base.amount_cents) + expectedIn - expectedOut !== expectedClosing)
      throw new Error('Os valores preservados da previsão não conservam a equação do caixa.');
    const opening = BigInt(realized.totals.opening_cents!) - BigInt(original.base.amount_cents);
    const incoming = BigInt(realized.totals.in_cents!) - expectedIn;
    const outgoing = BigInt(realized.totals.out_cents!) - expectedOut;
    const closing = BigInt(realized.totals.closing_cents!) - expectedClosing;
    if (opening + incoming - outgoing !== closing) throw new Error('A decomposição da diferença não conserva o caixa.');
    return { available: true as const, matches: opening === 0n && incoming === 0n && outgoing === 0n && closing === 0n,
      expected: {opening_cents: original.base.amount_cents, in_cents: expectedIn.toString(), out_cents: expectedOut.toString(), closing_cents: expectedClosing.toString()},
      actual: {opening_cents: realized.totals.opening_cents!, in_cents: realized.totals.in_cents!, out_cents: realized.totals.out_cents!, closing_cents: realized.totals.closing_cents!},
      differences: { opening_cents: opening.toString(), in_cents: incoming.toString(), out_cents: outgoing.toString(), closing_cents: closing.toString() } };
  };
  return {
    tenant_id: original.tenant_id, account_ids: [...original.account_ids],
    period: { ...realized.period }, original_captured_at: original.captured_at,
    realized_revision: realized.revision, realized_captured_at: realized.captured_at,
    base_confirmation: original.base.confirmation, whole_company_scope: realized.account_scope.complete,
    flow_basis: 'gross_cash' as const,
    confirmed: compare(false), expanded: compare(true),
    // Aggregate differences are not evidence of a specific cause or fraudulent act.
    cause_attribution: 'not_determined' as const,
  };
}
