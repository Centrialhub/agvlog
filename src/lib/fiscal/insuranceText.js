/**
 * Texto padronizado do seguro (seguradora / apólice / averbação / valor segurado)
 * usado para garantir a impressão dos mesmos dados no CT-e e na NFS-e.
 */
import { formatCnpj, onlyDigits } from './insuranceValidation';
function money(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0)
        return null;
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function hasInsuranceData(ins) {
    if (!ins)
        return false;
    return !!((ins.insurer_name || ins.seguradora || ins.nome || ins.xSeg || '').trim() ||
        onlyDigits(ins.insurer_cnpj || ins.cnpjSeguradora || ins.cnpj) ||
        (ins.insurer_policy || ins.apolice || ins.nApol || '').trim() ||
        (ins.insurer_endorsement || ins.averbacao || (Array.isArray(ins.nAver) ? ins.nAver[0] : ins.nAver) || '').trim() ||
        Number(ins.insured_amount || ins.valorSegurado) > 0 ||
        Number(ins.insurance_premium || ins.valorSeguro) > 0);
}
/**
 * Linha única, pronta para ser anexada à discriminação/observação da NFS-e —
 * é assim que os dados do seguro ficam visíveis na impressão da nota, já que
 * o padrão ABRASF não possui bloco próprio de seguro.
 */
export function buildInsuranceText(ins) {
    if (!hasInsuranceData(ins))
        return '';
    const parts = [];
    const name = (ins.insurer_name || ins.seguradora || ins.nome || ins.xSeg || '').trim();
    const cnpj = onlyDigits(ins.insurer_cnpj || ins.cnpjSeguradora || ins.cnpj);
    const policy = (ins.insurer_policy || ins.apolice || ins.nApol || '').trim();
    const endorsement = (ins.insurer_endorsement || ins.averbacao || (Array.isArray(ins.nAver) ? ins.nAver[0] : ins.nAver) || '').trim();
    const insured = money(ins.insured_amount || ins.valorSegurado);
    const premium = money(ins.insurance_premium || ins.valorSeguro);
    if (name)
        parts.push(`Seguradora: ${name}`);
    if (cnpj)
        parts.push(`CNPJ seguradora: ${formatCnpj(cnpj)}`);
    if (policy)
        parts.push(`Apólice: ${policy}`);
    if (endorsement)
        parts.push(`Averbação: ${endorsement}`);
    if (insured)
        parts.push(`Valor segurado: R$ ${insured}`);
    if (premium)
        parts.push(`Prêmio do seguro: R$ ${premium}`);
    return `Seguro da carga — ${parts.join(' | ')}`;
}
