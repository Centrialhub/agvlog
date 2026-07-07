import { DoccobBuildInput, DoccobInvoiceInput } from './doccobTypes';

export interface DoccobValidationIssue {
  invoiceId?: string;
  code: string;
  message: string;
  level: 'error' | 'warning';
}

export function validateDoccobExportInput(input: DoccobBuildInput): DoccobValidationIssue[] {
  const issues: DoccobValidationIssue[] = [];
  if (!input.carrier?.cnpj) {
    issues.push({ code: 'carrier_cnpj_missing', message: 'CNPJ da transportadora não configurado.', level: 'error' });
  }
  if (!input.carrier?.name) {
    issues.push({ code: 'carrier_name_missing', message: 'Razão social da transportadora não configurada.', level: 'error' });
  }
  if (!input.invoices?.length) {
    issues.push({ code: 'no_invoices', message: 'Nenhuma fatura selecionada.', level: 'error' });
  }
  for (const invoice of input.invoices ?? []) {
    issues.push(...validateInvoice(invoice));
  }
  return issues;
}

function validateInvoice(invoice: DoccobInvoiceInput): DoccobValidationIssue[] {
  const issues: DoccobValidationIssue[] = [];
  if (!invoice.dueDate) {
    issues.push({ invoiceId: invoice.id, code: 'due_date_missing', message: `Fatura ${invoice.invoiceNumber} sem data de vencimento.`, level: 'error' });
  }
  if (!invoice.clientName) {
    issues.push({ invoiceId: invoice.id, code: 'client_missing', message: `Fatura ${invoice.invoiceNumber} sem cliente.`, level: 'error' });
  }
  if (!(invoice.totalAmount > 0)) {
    issues.push({ invoiceId: invoice.id, code: 'invalid_amount', message: `Fatura ${invoice.invoiceNumber} com valor inválido.`, level: 'error' });
  }
  const chargeSum = invoice.charges.reduce((acc, c) => acc + (Number(c.grossAmount) || 0), 0);
  const diff = Math.abs(chargeSum - invoice.totalAmount);
  if (diff > 0.05) {
    issues.push({
      invoiceId: invoice.id,
      code: 'total_mismatch',
      message: `Fatura ${invoice.invoiceNumber}: soma das cobranças (${chargeSum.toFixed(2)}) difere do total (${invoice.totalAmount.toFixed(2)}).`,
      level: 'error',
    });
  }
  return issues;
}

export function validateTotals(expectedTotal: number, actualTotal: number, tolerance = 0.05): DoccobValidationIssue | null {
  if (Math.abs(expectedTotal - actualTotal) > tolerance) {
    return {
      code: 'trailer_total_mismatch',
      message: `Total do trailer (${actualTotal.toFixed(2)}) diverge do esperado (${expectedTotal.toFixed(2)}).`,
      level: 'error',
    };
  }
  return null;
}

export function validateFileName(pattern: string, resolved: string): DoccobValidationIssue | null {
  if (!pattern) {
    return { code: 'pattern_missing', message: 'Padrão do nome de arquivo não configurado.', level: 'error' };
  }
  if (!resolved || /\{\w+\}/.test(resolved)) {
    return { code: 'pattern_unresolved', message: 'Nome do arquivo contém variáveis não resolvidas.', level: 'error' };
  }
  if (!/\.txt$/i.test(resolved)) {
    return { code: 'pattern_extension', message: 'Nome do arquivo deve terminar com .txt.', level: 'warning' };
  }
  return null;
}

export function resolveFileName(pattern: string, date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return pattern
    .replace(/\{dd\}/g, pad(date.getDate()))
    .replace(/\{mm\}/g, pad(date.getMonth() + 1))
    .replace(/\{yyyy\}/g, String(date.getFullYear()))
    .replace(/\{hh\}/g, pad(date.getHours()))
    .replace(/\{MM\}/g, pad(date.getMinutes()));
}