import { restoreStateRegistrationLeadingZeros } from './stateRegistrationZeros';

/**
 * Normalização e validação básica de Inscrição Estadual (IE) e Indicador de IE
 * usadas no auto-cadastro de clientes durante a importação de XML/ORT.
 *
 * Regras conservadoras: nunca inventa dado. Quando o valor é ilegível,
 * inconsistente ou foi marcado como UNKNOWN pela OCR, retorna 'UNKNOWN'
 * para sinalizar revisão manual.
 */

export const FISCAL_UNKNOWN = 'UNKNOWN';

const IE_LENGTH_BY_UF: Record<string, number[]> = {
  AC: [13], AL: [9], AM: [9], AP: [9], BA: [8, 9], CE: [9], DF: [13],
  ES: [9], GO: [9], MA: [9], MG: [13], MS: [9], MT: [11], PA: [9],
  PB: [9], PE: [9, 14], PI: [9], PR: [10], RJ: [8], RN: [9, 10],
  RO: [14], RR: [9], RS: [10], SC: [9], SE: [9], SP: [12], TO: [9, 11],
};

function looksUnknown(raw?: string | null): boolean {
  if (!raw) return false;
  const v = String(raw).trim().toUpperCase();
  return v === FISCAL_UNKNOWN || v === '?' || v === 'ILEGIVEL' || v === 'ILEGÍVEL';
}

function isIsento(raw?: string | null): boolean {
  if (!raw) return false;
  const v = String(raw).trim().toUpperCase();
  return v === 'ISENTO' || v === 'ISENTA' || v === 'IS' || v === 'EX';
}

export interface IeNormalizationResult {
  /** Valor normalizado: dígitos contínuos, 'ISENTO', 'UNKNOWN' ou null. */
  value: string | null;
  /** true quando reconhecidamente ilegível/baixa confiança. */
  unknown: boolean;
  /** true quando o contribuinte está marcado como isento. */
  isento: boolean;
}

/**
 * Normaliza Inscrição Estadual.
 * @param raw  valor extraído do XML/OCR
 * @param uf   UF do destinatário (para validação de tamanho)
 * @param confidence  opcional — confiança 0..1; abaixo de 0.5 marca UNKNOWN
 */
export function normalizeStateRegistration(
  raw?: string | null,
  uf?: string | null,
  confidence?: number,
): IeNormalizationResult {
  if (looksUnknown(raw)) return { value: FISCAL_UNKNOWN, unknown: true, isento: false };
  if (isIsento(raw)) return { value: 'ISENTO', unknown: false, isento: true };
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return { value: null, unknown: false, isento: false };
  if (typeof confidence === 'number' && confidence >= 0 && confidence < 0.5) {
    return { value: FISCAL_UNKNOWN, unknown: true, isento: false };
  }
  const restored = restoreStateRegistrationLeadingZeros(raw, uf);
  if (restored) return { value: restored, unknown: false, isento: false };
  const ufKey = (uf || '').trim().toUpperCase();
  const allowed = IE_LENGTH_BY_UF[ufKey];
  if (allowed && allowed.length && !allowed.includes(digits.length)) {
    // Tamanho incompatível com a UF → não confia, mas preserva os dígitos lidos
    // marcando como UNKNOWN para forçar revisão.
    return { value: FISCAL_UNKNOWN, unknown: true, isento: false };
  }
  // Sem UF conhecida, exige tamanho mínimo plausível (8-14)
  if (!allowed && (digits.length < 8 || digits.length > 14)) {
    return { value: FISCAL_UNKNOWN, unknown: true, isento: false };
  }
  return { value: digits, unknown: false, isento: false };
}

export interface IndIeNormalizationResult {
  /** Código padronizado: '1' | '2' | '9' | 'UNKNOWN' | null */
  code: '1' | '2' | '9' | typeof FISCAL_UNKNOWN | null;
  /** Descrição compatível com o cadastro do cliente. */
  description: string | null;
  /** Sugere taxes_enabled (false somente quando isento confirmado). */
  taxesEnabled: boolean;
  unknown: boolean;
}

/**
 * Normaliza o indicador de IE do destinatário, podendo inferir a partir da IE
 * normalizada quando o indicador não vem na nota.
 */
export function normalizeIeIndicator(
  rawIndicator?: string | null,
  ie?: IeNormalizationResult,
): IndIeNormalizationResult {
  const v = String(rawIndicator || '').trim().toUpperCase();
  if (v === FISCAL_UNKNOWN) {
    return { code: FISCAL_UNKNOWN, description: FISCAL_UNKNOWN, taxesEnabled: true, unknown: true };
  }
  if (v === '1' || v === 'CONTRIBUINTE' || v === 'C') {
    return { code: '1', description: 'Contribuinte ICMS', taxesEnabled: true, unknown: false };
  }
  if (v === '2' || v === 'ISENTO' || v === 'I') {
    return { code: '2', description: 'Isento', taxesEnabled: false, unknown: false };
  }
  if (v === '9' || v === 'NAO' || v === 'NÃO' || v === 'NC') {
    return { code: '9', description: 'Não Contribuinte', taxesEnabled: true, unknown: false };
  }
  // Sem indicador: inferir pela IE quando possível
  if (ie?.isento) return { code: '2', description: 'Isento', taxesEnabled: false, unknown: false };
  if (ie?.unknown) return { code: FISCAL_UNKNOWN, description: FISCAL_UNKNOWN, taxesEnabled: true, unknown: true };
  if (ie?.value && /^\d+$/.test(ie.value)) {
    return { code: '1', description: 'Contribuinte ICMS', taxesEnabled: true, unknown: false };
  }
  return { code: null, description: null, taxesEnabled: true, unknown: false };
}