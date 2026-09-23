export type PendingOperation = {
  key: string;
  label: string;
  route: string;
  persistent: boolean;
  reference: string;
};
const destinations: [RegExp, string, string][] = [
  [
    /manual-title.*:receivable$|receivable-|customer-credit/,
    "Contas a receber",
    "/receivables",
  ],
  [
    /manual-title.*:payable$|payable-|approval-policy/,
    "Contas a pagar",
    "/payables",
  ],
  [/client-invoice/, "Faturas por cliente", "/client-invoices"],
  [/fiscal-review/, "Revisão fiscal", "/financial/fiscal-queue"],
  [/cash-forecast/, "Previsão de caixa", "/financial/cash-forecast"],
  [
    /account-period|cash-period|account-opening|legacy-cut/,
    "Abertura e fechamento por conta",
    "/financial/movements",
  ],
  [/employee-advance|payroll/, "Folha e adiantamentos", "/payroll"],
  [/settlement|driver-advance/, "Acertos de motoristas", "/driver-settlements"],
  [
    /expense|cost-|unloading|complement|maintenance|stock-/,
    "Despesas e origens",
    "/financial/recorded-expenses",
  ],
  [
    /statement|reconciliation/,
    "Conciliação e conferência",
    "/bank-reconciliation",
  ],
  [/movement|transfer/, "Movimentações", "/financial/movements"],
];
export function listStoredOperations(
  storage: Storage,
  tenant: string,
  actor: string,
  persistent: boolean,
): PendingOperation[] {
  const rows: PendingOperation[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (
      !key ||
      !key.split(":").includes(tenant) ||
      !key.includes(`:${tenant}:${actor}`)
    )
      continue;
    const matched = destinations.find(([pattern]) => pattern.test(key));
    if (!matched) continue;
    const suffix = key
      .slice(
        key.indexOf(`:${tenant}:${actor}`) + tenant.length + actor.length + 2,
      )
      .replace(/^:/, "");
    rows.push({
      key,
      label: matched[1],
      route: matched[2],
      persistent,
      reference: suffix,
    });
  }
  return rows;
}
