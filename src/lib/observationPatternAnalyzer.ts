/**
 * Observation Pattern Analyzer
 * --------------------------------------------------------------------------
 * Quando o número da carga do cliente NÃO é encontrado pelas regras em
 * `CLIENT_LOAD_OBSERVATION_RULES`, juntamos snippets de observação para tentar
 * descobrir padrões recorrentes e SUGERIR novas regras.
 *
 * Estratégia:
 *  1) Normalizar o texto (lower, sem acento, espaços colapsados).
 *  2) Criar uma "assinatura" trocando:
 *       sequências de dígitos -> #
 *       letras                -> a
 *     Isso agrupa textos com a mesma forma estrutural.
 *  3) Em paralelo, varrer cada snippet em busca de "tokens-chave":
 *       palavra alfa (3-25 letras) imediatamente antes de uma sequência
 *       numérica/alfanumérica (com até 1-2 separadores `:` `nº` `#` `-`).
 *     Cada token-chave vira candidato a regra.
 *  4) Agrupar por (1) assinatura E por (2) token-chave; somar contagens.
 *  5) Para cada token-chave com contagem mínima, gerar:
 *       - id sugerido (slug)
 *       - label legível (capitalizado)
 *       - regex no MESMO formato das regras existentes
 *       - exemplos extraídos (até 5)
 *
 * Não toca no DB nem nas regras vigentes — apenas analisa amostras em memória
 * e devolve sugestões para o usuário avaliar.
 */

import { CLIENT_LOAD_OBSERVATION_RULES } from './documentParsers';

// ── helpers ──────────────────────────────────────────────────────────────

const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Normaliza para comparação fuzzy: lower, sem acento, espaços simples. */
export function normalizeObservation(text: string): string {
  return stripAccents(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Gera assinatura estrutural (forma) — agrupa textos com mesmo "esqueleto". */
export function structuralSignature(text: string, maxLen = 120): string {
  const norm = normalizeObservation(text);
  // dígitos -> #, letras -> a, restante mantido
  const sig = norm
    .replace(/\d+/g, '#')
    .replace(/[a-z]+/g, 'a')
    .slice(0, maxLen);
  return sig;
}

const STOP_WORDS = new Set([
  'de', 'da', 'do', 'das', 'dos',
  'a', 'o', 'as', 'os', 'e', 'em', 'no', 'na',
  'para', 'com', 'por', 'sem',
  'cliente', 'destinatario', 'remetente', 'transportador',
  'nfe', 'nf', 'cfe', 'cte', 'mdfe',
  'icms', 'ipi', 'pis', 'cofins', 'cbs', 'ibs',
  'valor', 'total', 'liquido', 'bruto',
  'data', 'hora', 'numero', 'num', 'no', 'nº',
  'chave', 'serie', 'observacao', 'observacoes', 'obs',
  'documento', 'doc', 'emissao', 'vencimento',
]);

/** Slugifica um label para virar um id válido (ascii lower, _ separador). */
export function slugify(s: string): string {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'regra';
}

function capitalize(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** IDs já registrados nas regras vigentes — para evitar sugerir duplicado. */
function existingRuleIds(): Set<string> {
  return new Set(CLIENT_LOAD_OBSERVATION_RULES.map(r => r.id));
}

// ── núcleo ───────────────────────────────────────────────────────────────

export interface PatternSample {
  /** Snippet original da observação (já truncado pelo upstream). */
  observation: string;
  /** Identificador da NF-e para o usuário rastrear (invoiceNumber/accessKey). */
  reference?: string;
}

export interface KeywordCluster {
  /** Token-chave normalizado (ex.: "romaneio", "carregamento"). */
  keyword: string;
  /** Label sugerido (capitalizado). */
  suggestedLabel: string;
  /** Id sugerido (slug). */
  suggestedId: string;
  /** Quantas observações casaram. */
  count: number;
  /** Exemplos do "valor capturado" pela regex sugerida. */
  capturedExamples: string[];
  /** Exemplos de trecho onde o token apareceu (com contexto). */
  contextExamples: string[];
  /** Regex sugerida (objeto + string copiável). */
  suggestedPattern: RegExp;
  suggestedPatternSource: string;
  /** Linha pronta para colar em CLIENT_LOAD_OBSERVATION_RULES. */
  suggestedRuleSnippet: string;
  /** Indica se já existe regra com mesmo id/keyword. */
  alreadyCovered: boolean;
}

export interface SignatureCluster {
  signature: string;
  count: number;
  examples: string[];
}

export interface AnalyzerResult {
  totalSamples: number;
  /** Quantas amostras tinham observação minimamente útil. */
  usableSamples: number;
  keywordClusters: KeywordCluster[];
  signatureClusters: SignatureCluster[];
}

/**
 * Constrói uma regex no MESMO estilo das regras existentes:
 *  /\bKEYWORD[:\s\-#nº°.]*([A-Za-z0-9][A-Za-z0-9\-\/]{0,30})/i
 * O usuário pode copiar e colar diretamente em CLIENT_LOAD_OBSERVATION_RULES.
 */
function buildSuggestedPattern(keyword: string): { regex: RegExp; source: string } {
  const safe = escapeForRegex(keyword);
  const source = `/\\b${safe}[:\\s\\-#nº°.]*([A-Za-z0-9][A-Za-z0-9\\-\\/]{0,30})/i`;
  const regex = new RegExp(`\\b${safe}[:\\s\\-#nº°.]*([A-Za-z0-9][A-Za-z0-9\\-\\/]{0,30})`, 'i');
  return { regex, source };
}

/**
 * Analisa as amostras e devolve clusters + sugestões.
 *
 * @param samples Lista de observações com referência opcional.
 * @param opts.minOccurrences Mínimo para considerar um keyword recorrente (default 2).
 * @param opts.topKeywords Limita keywords retornadas (default 12).
 * @param opts.topSignatures Limita assinaturas retornadas (default 8).
 */
export function analyzeObservations(
  samples: PatternSample[],
  opts: { minOccurrences?: number; topKeywords?: number; topSignatures?: number } = {},
): AnalyzerResult {
  const minOccurrences = opts.minOccurrences ?? 2;
  const topKeywords = opts.topKeywords ?? 12;
  const topSignatures = opts.topSignatures ?? 8;

  const usable = samples.filter(s => (s.observation || '').trim().length >= 6);

  // 1) Assinaturas estruturais
  const sigMap = new Map<string, SignatureCluster>();
  for (const s of usable) {
    const sig = structuralSignature(s.observation);
    if (!sig) continue;
    const cur = sigMap.get(sig) || { signature: sig, count: 0, examples: [] };
    cur.count++;
    if (cur.examples.length < 3) cur.examples.push(s.observation.slice(0, 160));
    sigMap.set(sig, cur);
  }

  // 2) Tokens-chave: palavra alfa antes de número/alfa-numérico
  // Capturamos: <palavra>(opt separadores)<valor>
  const KEYWORD_VALUE_RE = /([a-zà-úç]{3,25})\s*[:\s\-#nº°.]{0,6}\s*([a-z0-9][a-z0-9\-\/]{1,30})/gi;

  type KAcc = {
    keyword: string;
    count: number;
    captured: string[];
    contexts: string[];
    seenRefs: Set<string>;
  };
  const kwMap = new Map<string, KAcc>();

  for (const s of usable) {
    const norm = normalizeObservation(s.observation);
    const seenInThisDoc = new Set<string>();
    let m: RegExpExecArray | null;
    KEYWORD_VALUE_RE.lastIndex = 0;
    while ((m = KEYWORD_VALUE_RE.exec(norm)) !== null) {
      const kw = m[1];
      const val = m[2];
      // valor precisa ter pelo menos 1 dígito — senão é só "palavra palavra"
      if (!/\d/.test(val)) continue;
      // descarta stop words e palavras puramente numéricas
      if (STOP_WORDS.has(kw)) continue;
      if (kw.length < 3) continue;
      // evita contar a mesma keyword múltiplas vezes no mesmo doc
      if (seenInThisDoc.has(kw)) continue;
      seenInThisDoc.add(kw);

      const acc = kwMap.get(kw) || {
        keyword: kw,
        count: 0,
        captured: [],
        contexts: [],
        seenRefs: new Set<string>(),
      };
      acc.count++;
      if (acc.captured.length < 5) acc.captured.push(val);
      if (acc.contexts.length < 3) {
        // contexto = ±25 chars ao redor do match
        const start = Math.max(0, m.index - 10);
        const end = Math.min(norm.length, m.index + m[0].length + 25);
        acc.contexts.push(norm.slice(start, end).trim());
      }
      if (s.reference) acc.seenRefs.add(s.reference);
      kwMap.set(kw, acc);
    }
  }

  // 3) Filtra por minOccurrences e prepara saída
  const existingIds = existingRuleIds();
  const keywordClusters: KeywordCluster[] = Array.from(kwMap.values())
    .filter(k => k.count >= minOccurrences)
    .sort((a, b) => b.count - a.count)
    .slice(0, topKeywords)
    .map(k => {
      const { regex, source } = buildSuggestedPattern(k.keyword);
      const id = slugify(k.keyword);
      const label = k.keyword.split(/\s+/).map(capitalize).join(' ');
      const alreadyCovered = existingIds.has(id) || CLIENT_LOAD_OBSERVATION_RULES.some(r => r.pattern.source.toLowerCase().includes(k.keyword));
      const suggestedRuleSnippet = `{ id: '${id}', label: '${label}', pattern: ${source} },`;
      return {
        keyword: k.keyword,
        suggestedId: id,
        suggestedLabel: label,
        count: k.count,
        capturedExamples: k.captured,
        contextExamples: k.contexts,
        suggestedPattern: regex,
        suggestedPatternSource: source,
        suggestedRuleSnippet,
        alreadyCovered,
      };
    });

  const signatureClusters: SignatureCluster[] = Array.from(sigMap.values())
    .filter(s => s.count >= minOccurrences)
    .sort((a, b) => b.count - a.count)
    .slice(0, topSignatures);

  return {
    totalSamples: samples.length,
    usableSamples: usable.length,
    keywordClusters,
    signatureClusters,
  };
}