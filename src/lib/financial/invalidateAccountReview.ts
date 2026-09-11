import type {QueryClient} from '@tanstack/react-query';

// One statement can affect several periods, including a previous-day opening anchor.
export function invalidateAccountReview(client:QueryClient,tenant:string){
 return Promise.all(['finance-receivable-history','finance-period-money-package','finance-account-period-close-preview','finance-account-period-close-history','finance-account-period-evidence','finance-legacy-cut-review','finance-legacy-cost-context','finance-legacy-cost-inventory','finance-unbilled-freight-summary','finance-unbilled-freight-origins','finance-recorded-cost-summary','finance-fiscal-dashboard-summary','finance-receivable-portfolio','finance-receivable-payments','finance-account-opening','finance-account-period','finance-period-evidence','finance-statement-coverage-review','finance-legacy-inventory','finance-legacy-integrity-inventory','finance-legacy-payable-association','finance-legacy-receivable-association','finance-transfer-period']
  .concat(['finance-cost-regularization-sources','finance-cost-regularization-preview','finance-cost-dispositions','finance-manual-expense-cancellation','finance-payable-portfolio','finance-expense-cancellation','finance-cash-period-counts','finance-cash-period-close-preview','finance-maintenance-cost-context','finance-maintenance-labor-context','finance-maintenance-direct-part-context','finance-stock-acquisition-context','finance-stock-cost-inventory','finance-stock-consumption-context','finance-stock-consumption-preview'])
  .map(key=>client.invalidateQueries({queryKey:[key,tenant]})));
}

export function invalidateAccountDirectory(client:QueryClient,tenant:string){
 return Promise.all([invalidateAccountReview(client,tenant),...['bank_accounts','finance-active-accounts','finance-account-directory','finance-opening-account','finance-native-account','finance-automatic-reconciliation']
  .map(key=>client.invalidateQueries({queryKey:[key,tenant]}))]);
}
