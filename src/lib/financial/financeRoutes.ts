export const financeRouteDestinations = [
  ['/financial', 'Visão geral'],
  ['/receivables', 'A receber'],
  ['/payables', 'A pagar'],
  ['/financial/movements', 'Movimentações'],
  ['/financial/recorded-expenses', 'Despesas'],
  ['/financial/statements', 'Extratos'],
  ['/financial/audit', 'Auditoria'],
  ['/financial/cash-forecast', 'Previsão de caixa'],
  ['/financial/fiscal-queue', 'Recebíveis fiscais'],
  ['/client-invoices', 'Faturas por cliente'],
  ['/billing-edi', 'Arquivo de cobrança'],
  ['/closing-reports', 'Fechamentos'],
  ['/expense-approval', 'Aprovação de despesas'],
  ['/bank-reconciliation', 'Conciliação'],
  ['/cost-centers', 'Centros de custo'],
  ['/payroll', 'Folha'],
  ['/driver-settlements', 'Acertos'],
] as const;

export function isFinancialPath(path:string){
  return financeRouteDestinations.some(([route])=>path===route||path.startsWith(`${route}/`));
}
