/**
 * Mapeamento automático de "tipo de operação" (espelhando SIAT)
 * para o enum `operation_type` no banco.
 *
 * Estratégia em camadas (primeira que casar vence):
 *   1. Override explícito do usuário (UI)
 *   2. CFOP do item da NF-e (regras SEFAZ + heurísticas TMS)
 *   3. Palavras-chave em natureza da operação / observações
 *   4. Fallback: null (operador decide manualmente)
 */

export const OPERATION_TYPES = [
  'filial',
  'armazenagem',
  'frota',
  'viagem_direta',
  'retira',
  'transferencia',
  'devolucao',
  'redespacho',
] as const;

export type OperationType = typeof OPERATION_TYPES[number];

export const OPERATION_TYPE_LABELS: Record<OperationType, string> = {
  filial: 'Filial',
  armazenagem: 'Armazenagem',
  frota: 'Frota',
  viagem_direta: 'Viagem Direta',
  retira: 'Retira',
  transferencia: 'Transferência',
  devolucao: 'Devolução',
  redespacho: 'Redespacho/Sub',
};

export const OPERATION_TYPE_DESCRIPTIONS: Record<OperationType, string> = {
  filial: 'Movimentação interna entre filiais da mesma empresa',
  armazenagem: 'Carga destinada a armazém / cross-docking antes da entrega final',
  frota: 'Operação executada com frota própria',
  viagem_direta: 'Coleta e entrega direta sem passar por filial/armazém',
  retira: 'Cliente ou destinatário retira a mercadoria na origem',
  transferencia: 'Transferência de mercadoria entre estabelecimentos do mesmo CNPJ',
  devolucao: 'Devolução de mercadoria ao remetente',
  redespacho: 'Subcontratação ou redespacho via outra transportadora',
};

export const OPERATION_TYPE_OPTIONS = OPERATION_TYPES.map(v => ({
  value: v,
  label: OPERATION_TYPE_LABELS[v],
  description: OPERATION_TYPE_DESCRIPTIONS[v],
}));

/** Sentinel para Radix Select (não pode ter value=""). */
export const OPERATION_TYPE_NONE = '__none__';

export function isValidOperationType(value: unknown): value is OperationType {
  return typeof value === 'string' && (OPERATION_TYPES as readonly string[]).includes(value);
}

/** Converte sentinel/null para valor do banco. */
export function toDbOperationType(value: string | null | undefined): OperationType | null {
  if (!value || value === OPERATION_TYPE_NONE) return null;
  return isValidOperationType(value) ? value : null;
}

/** Converte valor do banco para o formato esperado pelo Radix Select. */
export function fromDbOperationType(value: string | null | undefined): string {
  return isValidOperationType(value) ? value : OPERATION_TYPE_NONE;
}

// ============================================================================
// Inferência por CFOP
// ============================================================================

/**
 * Mapa CFOP → operation_type.
 *
 * Regras (SEFAZ + práticas TMS):
 *  - 5xxx/6xxx/7xxx = saídas; 1xxx/2xxx/3xxx = entradas (não relevantes aqui)
 *  - 5151/6151/5152/6152 → transferência (mesmo CNPJ)
 *  - 5409/6409 → transferência em substituição tributária
 *  - 5201–5210 / 6201–6210 → devolução de compra
 *  - 5410–5413 / 6410–6413 → devolução de venda
 *  - 5359/6359 → prestação de serviço de transporte (frete contratado)
 *  - 5353/6353 → redespacho
 *  - 5352/6352 → armazém geral / depósito
 *  - Demais 5xxx/6xxx → assume viagem_direta como fallback de saída
 */
const CFOP_RULES: Array<{ test: (cfop: string) => boolean; type: OperationType }> = [
  // Transferência (mesmo CNPJ)
  { test: (c) => /^[56]15[12]$/.test(c), type: 'transferencia' },
  { test: (c) => /^[56]409$/.test(c), type: 'transferencia' },

  // Devolução
  { test: (c) => /^[56]20[1-9]$/.test(c) || /^[56]210$/.test(c), type: 'devolucao' },
  { test: (c) => /^[56]41[0-3]$/.test(c), type: 'devolucao' },
  { test: (c) => /^[56]553$/.test(c), type: 'devolucao' }, // devolução simbólica

  // Redespacho
  { test: (c) => /^[56]353$/.test(c), type: 'redespacho' },
  { test: (c) => /^[56]360$/.test(c), type: 'redespacho' }, // sub-contratação

  // Armazenagem (depósito / armazém geral)
  { test: (c) => /^[56]352$/.test(c), type: 'armazenagem' },
  { test: (c) => /^[56]905$/.test(c), type: 'armazenagem' }, // remessa p/ depósito
  { test: (c) => /^[56]934$/.test(c), type: 'armazenagem' }, // remessa simbólica armazém

  // Frota / serviço próprio de transporte
  { test: (c) => /^[56]359$/.test(c), type: 'frota' },

  // Saídas genéricas → viagem direta
  { test: (c) => /^[56][0-9]{3}$/.test(c), type: 'viagem_direta' },
];

export function inferFromCfop(cfop: string | null | undefined): OperationType | null {
  if (!cfop) return null;
  const clean = String(cfop).replace(/\D/g, '');
  if (clean.length !== 4) return null;
  for (const rule of CFOP_RULES) {
    if (rule.test(clean)) return rule.type;
  }
  return null;
}

// ============================================================================
// Inferência por texto (natureza da operação / observações)
// ============================================================================

const KEYWORD_RULES: Array<{ pattern: RegExp; type: OperationType }> = [
  // ordem importa: regras mais específicas primeiro
  { pattern: /\b(devolu[çc][aã]o|retorno\s+de\s+mercadoria)\b/i, type: 'devolucao' },
  { pattern: /\b(transfer[eê]ncia)\b/i, type: 'transferencia' },
  { pattern: /\b(redespacho|sub[-\s]?contrata|subcontrat)\b/i, type: 'redespacho' },
  { pattern: /\b(retira|retirada|cliente\s+retira|client\s+pickup)\b/i, type: 'retira' },
  { pattern: /\b(armaz[eé]m|armazenagem|dep[oó]sito|cross[-\s]?dock)\b/i, type: 'armazenagem' },
  { pattern: /\b(filial|matriz)\b/i, type: 'filial' },
  { pattern: /\b(viagem\s+direta|entrega\s+direta|porta[-\s]?a[-\s]?porta)\b/i, type: 'viagem_direta' },
  { pattern: /\b(frota\s+pr[oó]pria|ve[ií]culo\s+pr[oó]prio)\b/i, type: 'frota' },
];

export function inferFromText(text: string | null | undefined): OperationType | null {
  if (!text) return null;
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(text)) return rule.type;
  }
  return null;
}

// ============================================================================
// API principal: inferOperationType
// ============================================================================

export interface OperationTypeInferenceInput {
  /** CFOP de qualquer item da NF-e (geralmente o predominante). */
  cfop?: string | null;
  /** Lista de CFOPs dos itens — se passada, escolhe o mais frequente. */
  cfops?: Array<string | null | undefined>;
  /** Natureza da operação da NF-e. */
  natureza?: string | null;
  /** Observações livres (infCpl / infAdFisco). */
  observation?: string | null;
  /** Override manual do usuário (vence tudo). */
  override?: string | null;
  /** CNPJ emitente vs destinatário (se iguais → transferência). */
  emitterCnpj?: string | null;
  recipientCnpj?: string | null;
}

export interface OperationTypeInferenceResult {
  type: OperationType | null;
  source: 'override' | 'same-cnpj' | 'cfop' | 'natureza' | 'observation' | 'none';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

function pickDominantCfop(cfops: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const c of cfops) {
    if (!c) continue;
    const clean = String(c).replace(/\D/g, '');
    if (clean.length === 4) counts.set(clean, (counts.get(clean) || 0) + 1);
  }
  if (counts.size === 0) return null;
  let best: [string, number] | null = null;
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
  return best?.[0] ?? null;
}

function sameCnpjRoot(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const ra = a.replace(/\D/g, '').slice(0, 8);
  const rb = b.replace(/\D/g, '').slice(0, 8);
  return ra.length === 8 && ra === rb;
}

export function inferOperationType(input: OperationTypeInferenceInput): OperationTypeInferenceResult {
  // 1. Override explícito
  if (input.override && isValidOperationType(input.override)) {
    return {
      type: input.override,
      source: 'override',
      confidence: 'high',
      reason: 'Definido manualmente pelo operador',
    };
  }

  // 2. Mesmo CNPJ raiz (8 primeiros dígitos) → transferência
  if (sameCnpjRoot(input.emitterCnpj, input.recipientCnpj)) {
    return {
      type: 'transferencia',
      source: 'same-cnpj',
      confidence: 'high',
      reason: 'Emitente e destinatário compartilham a mesma raiz de CNPJ',
    };
  }

  // 3. CFOP (item único ou predominante)
  const cfop = input.cfop || pickDominantCfop(input.cfops || []);
  const fromCfop = inferFromCfop(cfop);
  if (fromCfop) {
    return {
      type: fromCfop,
      source: 'cfop',
      confidence: 'high',
      reason: `Inferido pelo CFOP ${cfop}`,
    };
  }

  // 4. Natureza da operação
  const fromNatureza = inferFromText(input.natureza);
  if (fromNatureza) {
    return {
      type: fromNatureza,
      source: 'natureza',
      confidence: 'medium',
      reason: `Inferido pela natureza: "${input.natureza}"`,
    };
  }

  // 5. Observações
  const fromObs = inferFromText(input.observation);
  if (fromObs) {
    return {
      type: fromObs,
      source: 'observation',
      confidence: 'low',
      reason: 'Inferido a partir das observações da NF-e',
    };
  }

  return {
    type: null,
    source: 'none',
    confidence: 'low',
    reason: 'Não foi possível inferir automaticamente — defina manualmente',
  };
}

/** Atalho útil para os parsers de NF-e. */
export function inferOperationTypeFromParsedNFe(parsed: {
  items?: Array<{ cfop?: string | null }>;
  emitterCnpj?: string | null;
  recipientCnpj?: string | null;
  natureza?: string | null;
  observation?: string | null;
}): OperationTypeInferenceResult {
  return inferOperationType({
    cfops: (parsed.items || []).map(i => i.cfop),
    emitterCnpj: parsed.emitterCnpj,
    recipientCnpj: parsed.recipientCnpj,
    natureza: parsed.natureza,
    observation: parsed.observation,
  });
}