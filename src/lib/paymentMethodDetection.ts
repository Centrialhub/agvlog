// Detecção de forma de pagamento em texto livre de NF-e (infCpl/infAdFisco,
// xPag, termos de pagamento da ORT, etc.).
//
// Estratégia em camadas:
//  1) Normaliza texto (remove acentos, colapsa espaços).
//  2) Expande abreviações comuns ANTES de aplicar regex
//     (ex.: FP -> FORMA PAGAMENTO, COND PAG -> CONDICAO PAGAMENTO, DEP -> DEPOSITO).
//  3) Tenta primeiro CASAR EM CONTEXTO — pega o que vem depois de gatilhos
//     como "FORMA DE PAGAMENTO:", "COND. PAGTO:", "PAGAMENTO:" — para
//     evitar falsos positivos com palavras soltas dentro do nome do produto.
//  4) Cai para casamento global de palavras-chave robustas.
//  5) Detecta parcelamento (30/60/90, 2X, 3 PARCELAS) -> 'a_prazo'.
//
// Retorna `null` quando não há indício claro — assim NUNCA sobrescreve
// escolha manual posterior.

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Expande abreviações comuns de forma de pagamento em texto NORMALIZADO (upper, sem acento). */
function expandAbbreviations(t: string): string {
  return t
    // gatilhos de campo
    .replace(/\bFP\b/g, 'FORMA PAGAMENTO')
    .replace(/\bF\.\s*PAG\.?\b/g, 'FORMA PAGAMENTO')
    .replace(/\bCOND\.?\s*PAG(?:TO|AMENTO)?\.?\b/g, 'CONDICAO PAGAMENTO')
    .replace(/\bPAGTO\b/g, 'PAGAMENTO')
    // formas — códigos curtos usados em infCpl de ERPs
    // (ordem importa: variantes mais longas primeiro)
    .replace(/\bBCPARC\b/g, 'BOLETO PARCELADO')
    .replace(/\bBCP\b/g, 'BOLETO PARCELADO')
    .replace(/\bBC\b/g, 'BOLETO')
    .replace(/\bOP\b/g, 'ORDEM PAGAMENTO')
    .replace(/\bDM\b/g, 'DUPLICATA MERCANTIL')
    // formas
    .replace(/\bTRANSF\.?\b/g, 'TRANSFERENCIA')
    .replace(/\bDEP\.?\s*BANC(?:ARIO|\.)?\b/g, 'DEPOSITO BANCARIO')
    .replace(/\bDEPOSITO\b/g, 'TRANSFERENCIA')
    .replace(/\bBOL\.?\b/g, 'BOLETO')
    .replace(/\bDUP\.?\b/g, 'DUPLICATA')
    .replace(/\bDIN\.?\b/g, 'DINHEIRO')
    .replace(/\bC\.?\s*CRED(?:ITO)?\b/g, 'CARTAO CREDITO')
    .replace(/\bC\.?\s*DEB(?:ITO)?\b/g, 'CARTAO DEBITO')
    .replace(/\bCRED\.?\b/g, 'CREDITO')
    .replace(/\bDEB\.?\b/g, 'DEBITO')
    .replace(/\bFAT\.?\s*MENSAL\b/g, 'FATURADO');
}

const KEYWORD_RULES: Array<{ re: RegExp; value: string }> = [
  { re: /\bPIX\b/, value: 'pix' },
  { re: /\b(BOLETO|COBRANCA\s*BANCARIA|DUPLICATA|FATURA\s*BANCARIA)\b/, value: 'boleto' },
  { re: /\b(TED|DOC|TRANSFERENCIA(?:\s*(?:BANCARIA|ELETRONICA))?|DEPOSITO\s*BANCARIO|ORDEM\s*(?:DE\s*)?PAGAMENTO)\b/, value: 'transferencia' },
  { re: /\bCHEQUE\b/, value: 'cheque' },
  { re: /\b(DINHEIRO|ESPECIE)\b/, value: 'dinheiro' },
  { re: /\bCARTAO\s*(?:DE\s*)?CREDITO\b/, value: 'cartao_credito' },
  { re: /\bCARTAO\s*(?:DE\s*)?DEBITO\b/, value: 'cartao_debito' },
  { re: /\b(FATURADO|FATURA\s*MENSAL|FATURAMENTO\s*MENSAL)\b/, value: 'faturado' },
  // a_prazo: aceita 30/60/90 ou 21-28-35 (com ou sem "DIAS"), N DDL/DDF, NX, N PARCELAS,
  // e também "NN DIAS" isolado (ex.: "Cond. Pagto: 28 DIAS")
  // a_prazo: aceita "A PRAZO", listas N/N/N ou N-N-N, NX, N DDL/DDF, N PARCELAS,
  // ou "NN DIA(S)" — inclusive grudado em texto seguinte (ex.: "28 DIASCarga"
  // gerado por ERPs que removem espaços).
  { re: /(\b(?:A\s*PRAZO|APRAZO)\b|\b\d+(?:[\/\-]\d+)+\s*(?:DIAS?)?\b|\b\d+\s*DDL\b|\b\d+\s*DDF\b|\b\d+\s*X(?:\s|$)|\b\d+\s*PARCELAS?\b|\b\d{1,3}\s*DIAS?(?:\W|$|[A-Z]))/, value: 'a_prazo' },
  { re: /\b(A\s*VISTA|AVISTA|ANTECIPADO|PRE\s*PAGO)\b/, value: 'a_vista' },
];

/** Triggers contextuais: "FORMA PAGAMENTO:", "PAGAMENTO -", etc. */
const CONTEXT_TRIGGER = /\b(?:FORMA\s+(?:DE\s+)?PAGAMENTO|CONDICAO\s+(?:DE\s+)?PAGAMENTO|PAGAMENTO|PRAZO\s+(?:DE\s+)?PAGAMENTO|COBRANCA)\s*[:\-=]?\s*/g;

export type PaymentDetectionResult = {
  value: string | null;
  source: 'context' | 'keyword' | 'none';
  matched?: string;
};

/** Versão detalhada com auditoria. */
export function detectPaymentMethodDetailed(...texts: Array<string | null | undefined>): PaymentDetectionResult {
  const joined = texts.filter(Boolean).join(' | ');
  if (!joined) return { value: null, source: 'none' };

  // Normalizar: maiúsculas, sem acentos, sem espaços excessivos
  let t = ' ' + expandAbbreviations(stripDiacritics(joined.toUpperCase()).replace(/\s+/g, ' ')) + ' ';

  // 1) Casamento contextual: para cada gatilho, olhar até 60 chars seguintes
  const contextMatches: string[] = [];
  let m: RegExpExecArray | null;
  CONTEXT_TRIGGER.lastIndex = 0;
  while ((m = CONTEXT_TRIGGER.exec(t)) !== null) {
    const slice = t.slice(m.index + m[0].length, m.index + m[0].length + 60);
    contextMatches.push(slice);
  }
  for (const slice of contextMatches) {
    for (const r of KEYWORD_RULES) {
      if (r.re.test(slice)) return { value: r.value, source: 'context', matched: slice.trim().slice(0, 40) };
    }
  }

  // 2) Casamento global por palavra-chave
  for (const r of KEYWORD_RULES) {
    if (r.re.test(t)) return { value: r.value, source: 'keyword' };
  }

  return { value: null, source: 'none' };
}

/** API legada: retorna apenas o valor (string|null). Mantida para compatibilidade. */
export function detectPaymentMethod(...texts: Array<string | null | undefined>): string | null {
  return detectPaymentMethodDetailed(...texts).value;
}