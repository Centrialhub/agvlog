/**
 * Texto padronizado do seguro (seguradora / apólice / averbação / valor segurado)
 * usado para garantir a impressão dos mesmos dados no CT-e e na NFS-e.
 */

import { formatCnpj, onlyDigits } from './insuranceValidation';

export interface InsuranceSnapshot {
  insurer_name?: string | null;
  insurer_cnpj?: string | null;
  insurer_policy?: string | null;
  insurer_endorsement?: string | null;
  insured_amount?: number | string | null;
  insurance_premium?: number | string | null;
}

function money(v: any): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function hasInsuranceData(ins?: InsuranceSnapshot | null): boolean {
  if (!ins) return false;
  return !!(
    (ins.insurer_name || '').trim() ||
    onlyDigits(ins.insurer_cnpj) ||
    (ins.insurer_policy || '').trim() ||
    (ins.insurer_endorsement || '').trim() ||
    Number(ins.insured_amount) > 0 ||
    Number(ins.insurance_premium) > 0
  );
}

/**
 * Linha única, pronta para ser anexada à discriminação/observação da NFS-e —
 * é assim que os dados do seguro ficam visíveis na impressão da nota, já que
 * o padrão ABRASF não possui bloco próprio de seguro.
 */
export function buildInsuranceText(ins?: InsuranceSnapshot | null): string {
  if (!hasInsuranceData(ins)) return '';
  const parts: string[] = [];
  const name = (ins!.insurer_name || '').trim();
  const cnpj = onlyDigits(ins!.insurer_cnpj);
  const policy = (ins!.insurer_policy || '').trim();
  const endorsement = (ins!.insurer_endorsement || '').trim();
  const insured = money(ins!.insured_amount);
  const premium = money(ins!.insurance_premium);

  if (name) parts.push(`Seguradora: ${name}`);
  if (cnpj) parts.push(`CNPJ seguradora: ${formatCnpj(cnpj)}`);
  if (policy) parts.push(`Apólice: ${policy}`);
  if (endorsement) parts.push(`Averbação: ${endorsement}`);
  if (insured) parts.push(`Valor segurado: R$ ${insured}`);
  if (premium) parts.push(`Prêmio do seguro: R$ ${premium}`);

  return `Seguro da carga — ${parts.join(' | ')}`;
}