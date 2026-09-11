const roots=['/financial','/receivables','/payables','/client-invoices','/billing-edi','/closing-reports','/expense-approval','/driver-settlements','/bank-reconciliation','/cost-centers','/payroll'];
export function isFinancialPath(path:string){return roots.some(root=>path===root||path.startsWith(`${root}/`));}
