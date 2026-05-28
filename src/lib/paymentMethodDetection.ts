// Detecta forma de pagamento a partir de texto livre (observação da NF, infCpl,
// termos de pagamento da ORT, etc.). Retorna null quando não há indício claro
// — assim não sobrescreve escolha manual posterior.
export function detectPaymentMethod(...texts: Array<string | null | undefined>): string | null {
  const joined = texts.filter(Boolean).join(' | ');
  if (!joined) return null;
  const t = ` ${joined.toUpperCase()} `;
  const rules: Array<{ re: RegExp; value: string }> = [
    { re: /\bPIX\b/, value: 'pix' },
    { re: /\b(BOLETO|BOL\.?|\bBC\b|\bBB\b|\bBOL\b|COBRAN[ÇC]A\s*BANC[ÁA]RIA|DUPLICATA|DUP\.?)\b/, value: 'boleto' },
    { re: /\b(TED|DOC|TRANSFER[ÊE]NCIA|TRANSF\.?)\b/, value: 'transferencia' },
    { re: /\bCHEQUE\b|\bCH\b/, value: 'cheque' },
    { re: /\bDINHEIRO\b|\bESP[ÉE]CIE\b|\bDIN\b/, value: 'dinheiro' },
    { re: /\bCART[ÃA]O\s*(DE\s*)?CR[ÉE]DITO\b|\bCC\b/, value: 'cartao_credito' },
    { re: /\bCART[ÃA]O\s*(DE\s*)?D[ÉE]BITO\b|\bCD\b/, value: 'cartao_debito' },
    { re: /\bFATURADO\b|\bFATURA\b|\bFAT\.?\b/, value: 'faturado' },
    { re: /\bA\s*PRAZO\b|\bPRAZO\b|\bAPRAZ\b/, value: 'a_prazo' },
    { re: /\bA\s*VISTA\b|\b[ÀA]\s*VISTA\b|\bAVISTA\b/, value: 'a_vista' },
  ];
  for (const r of rules) if (r.re.test(t)) return r.value;
  return null;
}