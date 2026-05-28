// Detecta forma de pagamento a partir de texto livre (observação da NF, infCpl,
// termos de pagamento da ORT, etc.). Retorna null quando não há indício claro
// — assim não sobrescreve escolha manual posterior.
export function detectPaymentMethod(...texts: Array<string | null | undefined>): string | null {
  const joined = texts.filter(Boolean).join(' | ');
  if (!joined) return null;
  const t = ` ${joined.toUpperCase()} `;
  // Regras conservadoras: apenas palavras inteiras e termos sem ambiguidade.
  // Evita falsos positivos como "N DOC" (número do documento) virar "transferência".
  const rules: Array<{ re: RegExp; value: string }> = [
    { re: /\bPIX\b/, value: 'pix' },
    { re: /\b(BOLETO|COBRAN[ÇC]A\s*BANC[ÁA]RIA|DUPLICATA)\b/, value: 'boleto' },
    { re: /\b(TED|TRANSFER[ÊE]NCIA\s*BANC[ÁA]RIA|TRANSFER[ÊE]NCIA\s*ELETR[ÔO]NICA)\b/, value: 'transferencia' },
    { re: /\bCHEQUE\b/, value: 'cheque' },
    { re: /\b(DINHEIRO|ESP[ÉE]CIE)\b/, value: 'dinheiro' },
    { re: /\bCART[ÃA]O\s*(DE\s*)?CR[ÉE]DITO\b/, value: 'cartao_credito' },
    { re: /\bCART[ÃA]O\s*(DE\s*)?D[ÉE]BITO\b/, value: 'cartao_debito' },
    { re: /\b(FATURADO|FATURA\s*MENSAL)\b/, value: 'faturado' },
    { re: /\b(A\s*PRAZO|APRAZO)\b/, value: 'a_prazo' },
    { re: /\b(A\s*VISTA|[ÀA]\s*VISTA|AVISTA)\b/, value: 'a_vista' },
  ];
  for (const r of rules) if (r.re.test(t)) return r.value;
  return null;
}