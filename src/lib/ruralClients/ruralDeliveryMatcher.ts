// Heurísticas de detecção de zona rural / instruções em texto livre.

const norm = (s: unknown): string =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const RURAL_TERMS = [
  'zona rural', 'area rural', 'fazenda', 'faz.', 'comunidade',
  'povoado', 'projeto', 'distrito', 'sitio', 'chacara', 'assentamento',
];

export function containsRuralTerms(text: unknown): boolean {
  const s = norm(text);
  if (!s) return false;
  return RURAL_TERMS.some(t => s.includes(t));
}

export function detectRequiresContact(text: unknown): boolean {
  const s = norm(text);
  return /\bligar?\b|\bligue\b|\bligacao\b|\bligacoes\b/.test(s);
}

export function detectTaxiRequired(text: unknown): boolean {
  const s = norm(text);
  if (/nao\s+tem\s+taxi/.test(s)) return false;
  return /\btaxi\b|\bmototaxi\b|\bmoto taxi\b/.test(s);
}

export function detectDirtRoad(text: unknown): boolean {
  const s = norm(text);
  return /estrada\s+de\s+terra|estrada\s+de\s+chao|chao\s+batido/.test(s);
}

export function detectCityDelivery(text: unknown): string | null {
  const s = String(text ?? '');
  const m = s.match(/entrega(?:r)?\s+(?:na|em)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇa-záéíóúâêôãõç ]{3,40})/i);
  if (m) return m[1].trim();
  if (/\bvamos na cidade\b/i.test(s)) return 'cidade';
  return null;
}

export function inferAccessType(text: unknown): 'paved' | 'dirt_road' | 'mixed' | 'unknown' | null {
  const s = norm(text);
  if (!s) return null;
  if (detectDirtRoad(s) && /asfalto/.test(s)) return 'mixed';
  if (detectDirtRoad(s)) return 'dirt_road';
  if (/asfalto|pavimentad/.test(s)) return 'paved';
  return null;
}

export interface RuralInference {
  requires_contact_before_delivery: boolean;
  taxi_required: boolean;
  access_type: string | null;
  can_deliver_in_city: boolean;
  city_delivery_instructions: string | null;
  delivery_mode: 'direct' | 'city_pickup' | 'taxi' | 'third_party' | 'call_before' | 'unknown';
}

export function inferRuralAttributes(rawText: unknown, taxiText?: unknown): RuralInference {
  const combined = [rawText, taxiText].filter(Boolean).join(' | ');
  const requiresContact = detectRequiresContact(combined);
  const taxi = detectTaxiRequired(combined);
  const access = inferAccessType(combined);
  const city = detectCityDelivery(combined);
  let mode: RuralInference['delivery_mode'] = 'direct';
  if (taxi) mode = 'taxi';
  else if (city) mode = 'city_pickup';
  else if (requiresContact) mode = 'call_before';
  return {
    requires_contact_before_delivery: requiresContact,
    taxi_required: taxi,
    access_type: access,
    can_deliver_in_city: !!city,
    city_delivery_instructions: city && city !== 'cidade' ? `Entregar em ${city}` : (city ? 'Entregar na cidade' : null),
    delivery_mode: mode,
  };
}

/** Score de confiança para vincular NF/perfil rural. */
export function ruralMatchScore(input: {
  clientHasRuralFlag?: boolean;
  cityMatches?: boolean;
  neighborhoodMatches?: boolean;
  addressRuralHint?: boolean;
}): 'high' | 'medium' | 'low' {
  if (input.clientHasRuralFlag && input.cityMatches && input.neighborhoodMatches) return 'high';
  if (input.cityMatches && input.neighborhoodMatches) return 'medium';
  if (input.addressRuralHint || input.clientHasRuralFlag) return 'low';
  return 'low';
}

/** Chave de deduplicação para perfis por cliente+cidade+bairro+remetente. */
export function ruralProfileDedupeKey(input: {
  client_id: string;
  city?: string | null;
  neighborhood?: string | null;
  related_remitter_id?: string | null;
}): string {
  return [
    input.client_id,
    norm(input.city),
    norm(input.neighborhood),
    input.related_remitter_id || '',
  ].join('|');
}

export const normalizeText = norm;