export type NominatimAddress = Record<string, unknown>;

export type NominatimResult = {
  display_name?: string;
  importance?: number;
  type?: string;
  addresstype?: string;
  class?: string;
  place_rank?: number;
  address?: NominatimAddress;
};

const PRECISE_TYPES = new Set<string>([
  'house', 'building', 'residential', 'commercial', 'industrial', 'warehouse',
  'office', 'retail', 'supermarket', 'school', 'hospital', 'place_of_worship',
]);
const ROAD_TYPES = new Set<string>(['road', 'street', 'pedestrian', 'service', 'unclassified']);
const DISTRICT_TYPES = new Set<string>(['suburb', 'neighbourhood', 'quarter', 'postcode']);

function normalize(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim();
}

function addressValue(address: NominatimAddress | undefined, keys: string[]) {
  for (const key of keys) {
    const value = address?.[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

export function assessNominatimCandidate(result: NominatimResult, query: string) {
  const kind = normalize(result.addresstype || result.type);
  const queryNormalized = normalize(query);
  const labelNormalized = normalize(result.display_name);
  const houseNumber = normalize(addressValue(result.address, ['house_number']));
  const road = normalize(addressValue(result.address, ['road', 'pedestrian', 'footway', 'street']));
  const postcode = normalize(addressValue(result.address, ['postcode']));
  const queryNumbers: string[] = Array.from(queryNormalized.match(/\b\d+[a-z]?\b/g) ?? []);
  const exactHouse = Boolean(houseNumber && queryNumbers.includes(houseNumber));
  const roadTokens = road.split(' ').filter((token) => token.length >= 3);
  const matchingRoadTokens = roadTokens.filter((token) => queryNormalized.includes(token)).length;
  const roadMatch = roadTokens.length > 0 && matchingRoadTokens >= Math.min(2, roadTokens.length);
  const postcodeMatch = Boolean(postcode && queryNormalized.includes(postcode.replace(/\s/g, '')))
    || Boolean(postcode && queryNormalized.includes(postcode));

  if (exactHouse && roadMatch) return { confidence: 0.96, accuracy_m: 30, quality: 'address_exact' as const };
  if (PRECISE_TYPES.has(kind) && roadMatch) return { confidence: 0.84, accuracy_m: 75, quality: 'address_precise' as const };
  if (PRECISE_TYPES.has(kind) && labelNormalized && queryNumbers.some((number) => labelNormalized.includes(number))) {
    return { confidence: 0.78, accuracy_m: 100, quality: 'address_number_match' as const };
  }
  if (ROAD_TYPES.has(kind) && roadMatch) return { confidence: 0.62, accuracy_m: 180, quality: 'road_match' as const };
  if (postcodeMatch) return { confidence: 0.5, accuracy_m: 350, quality: 'postcode_match' as const };
  if (DISTRICT_TYPES.has(kind)) return { confidence: 0.32, accuracy_m: 900, quality: 'district_only' as const };
  return { confidence: 0.18, accuracy_m: 5000, quality: 'locality_only' as const };
}
