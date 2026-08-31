import { restoreStateRegistrationLeadingZeros } from '../stateRegistrationZeros';

/**
 * Resolução de partes do CT-e (remetente, destinatário, consignatário, etc.)
 * contra o cadastro local de clientes/fornecedores.
 *
 * Motivo: muitas NF-es chegam sem CNPJ, IE ou endereço completo. Sem esses
 * dados o Hub Fiscal rejeita a emissão por "falta de dados das partes".
 * Aqui casamos a parte com o cadastro por (1) id, (2) CNPJ, (3) nome
 * normalizado, e completamos SOMENTE o que estiver faltando.
 */

export interface RegistryClient {
  id?: string | null;
  company_name?: string | null;
  legal_name?: string | null;
  trade_name?: string | null;
  tax_id?: string | null;
  state_registration?: string | null;
  ie_indicator?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_complement?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_city_ibge_code?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
}

export interface PartyAddress {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  city_ibge: string | null;
  state: string | null;
  zip: string | null;
}

export interface ResolvedParty {
  name: string;
  cnpj: string | null;
  ie: string | null;
  ieIndicator?: string | null;
  address: PartyAddress | null;
}

export const digitsOnly = (v?: string | null) => (v || '').replace(/\D+/g, '');

/**
 * Sanitiza Inscrição Estadual antes de usar no CT-e.
 *
 * O auto-cadastro de clientes grava 'UNKNOWN' quando a IE lida da NF/OCR é
 * ilegível ou incompatível com a UF. Esse marcador NUNCA pode ir para o Hub
 * Fiscal/SEFAZ (rejeita o documento) nem preencher o campo do diálogo.
 * Retorna null para marcadores inválidos, 'ISENTO' quando isento e os dígitos
 * nos demais casos.
 */
export function sanitizeIe(v?: string | null): string | null {
  const raw = (v || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (/^(UNKNOWN|DESCONHECID[OA]|ILEG[IÍ]VEL|N\/?I|N\/?A|NAO INFORMAD[OA]|-+|\?+|0+)$/.test(upper)) {
    return null;
  }
  if (/^(ISENTO|ISENTA|IS|EX)$/.test(upper)) return 'ISENTO';
  const digits = digitsOnly(raw);
  return digits || null;
}

/** Nome comparável: sem acento, sem pontuação, sem sufixos societários. */
export function normalizeName(v?: string | null): string {
  return (v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\b(LTDA|LTD|ME|EPP|EIRELI|S\/?A|SA|MEI)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export interface ClientIndex {
  byId: Map<string, RegistryClient>;
  byCnpj: Map<string, RegistryClient>;
  byName: Map<string, RegistryClient>;
}

export function buildClientIndex(clients: RegistryClient[] = []): ClientIndex {
  const byId = new Map<string, RegistryClient>();
  const byCnpj = new Map<string, RegistryClient>();
  const byName = new Map<string, RegistryClient>();
  for (const c of clients || []) {
    if (!c) continue;
    if (c.id) byId.set(String(c.id), c);
    const k = digitsOnly(c.tax_id);
    if (k && !byCnpj.has(k)) byCnpj.set(k, c);
    for (const n of [c.company_name, c.legal_name, c.trade_name]) {
      const nk = normalizeName(n);
      if (nk && !byName.has(nk)) byName.set(nk, c);
    }
  }
  return { byId, byCnpj, byName };
}

/** Com documento informado, só usa cadastro do mesmo estabelecimento. */
export function findRegistryClient(
  index: ClientIndex,
  party: { id?: string | null; cnpj?: string | null; name?: string | null },
): RegistryClient | null {
  const k = digitsOnly(party.cnpj);
  const byId = party.id ? index.byId.get(String(party.id)) : undefined;
  // A NF pode estar vinculada a outra filial: nunca combinar seu CNPJ com a IE dela.
  if (k) return (byId && digitsOnly(byId.tax_id) === k ? byId : index.byCnpj.get(k)) || null;
  if (byId) return byId;
  const nk = normalizeName(party.name);
  if (nk && index.byName.has(nk)) return index.byName.get(nk)!;
  return null;
}

function addressFromClient(c: RegistryClient | null): PartyAddress | null {
  if (!c) return null;
  const addr: PartyAddress = {
    street: c.address_street || null,
    number: c.address_number || null,
    complement: c.address_complement || null,
    neighborhood: c.address_neighborhood || null,
    city: c.address_city || null,
    city_ibge: c.address_city_ibge_code || null,
    state: c.address_state || null,
    zip: c.address_zip || null,
  };
  return Object.values(addr).some(Boolean) ? addr : null;
}

/**
 * Monta a parte para o payload completando lacunas com o cadastro local.
 * Só devolve `null` quando não há nome nem cadastro correspondente.
 */
export function resolveParty(
  index: ClientIndex,
  party: {
    id?: string | null;
    name?: string | null;
    cnpj?: string | null;
    ie?: string | null;
  },
  fallbackAddress?: { 
    city?: string | null; 
    state?: string | null;
    street?: string | null;
    number?: string | null;
    neighborhood?: string | null;
    zip?: string | null;
    city_ibge?: string | null;
    codigoMunicipio?: string | null;
  } | null,
): ResolvedParty | null {
  const c = findRegistryClient(index, party);
  const name = (party.name || '').trim() || (c?.company_name || c?.legal_name || '').trim();
  if (!name) return null;
  const cnpj = digitsOnly(party.cnpj) || digitsOnly(c?.tax_id) || null;
  let ie = sanitizeIe(party.ie) || sanitizeIe(c?.state_registration);
  const fromClient = addressFromClient(c);
  const fallback: PartyAddress | null = fallbackAddress
    ? {
        street: fallbackAddress.street || null,
        number: fallbackAddress.number || null,
        complement: null,
        neighborhood: fallbackAddress.neighborhood || null,
        city: fallbackAddress.city || null,
        city_ibge: fallbackAddress.city_ibge || fallbackAddress.codigoMunicipio || null,
        state: fallbackAddress.state || null,
        zip: fallbackAddress.zip || null,
      }
    : null;
  // Mescla: cadastro preenche o que o fallback (dados da NF) não tem e vice-versa.
  const address =
    fromClient && fallback
      ? {
          ...fromClient,
          city: fromClient.city || fallback.city,
          city_ibge: fromClient.city_ibge || fallback.city_ibge,
          state: fromClient.state || fallback.state,
        }
      : fromClient || fallback;
  const rawIe = sanitizeIe(party.ie) ? party.ie : c?.state_registration;
  ie = restoreStateRegistrationLeadingZeros(rawIe, address?.state) ?? ie;
  return { name, cnpj, ie, address, ieIndicator: c?.ie_indicator || null };
}

/** Campos das partes editáveis no diálogo de emissão. */
export interface PartyFields {
  remitterName: string;
  remitterCnpj: string;
  remitterIe: string;
  recipientName: string;
  recipientCnpj: string;
  recipientIe: string;
  recipientCity: string;
  recipientState: string;
  clientId?: string | null;
}

/**
 * Completa os campos visíveis do CT-e com o cadastro local (nunca sobrescreve
 * valor já informado). Usado no diálogo para o operador ver o que será enviado.
 */
export function fillPartyFieldsFromRegistry<T extends PartyFields>(
  item: T,
  index: ClientIndex,
): { item: T; changed: boolean } {
  const rem = findRegistryClient(index, {
    cnpj: item.remitterCnpj,
    name: item.remitterName,
  });
  const rec = findRegistryClient(index, {
    id: item.clientId,
    cnpj: item.recipientCnpj,
    name: item.recipientName,
  });
  const next: T = { ...item };
  const mutable = next as unknown as Record<string, unknown>;
  let changed = false;
  const set = (key: string, value?: string | null) => {
    // O helper é genérico: só completa campos que fazem parte do formato
    // recebido, evitando criar propriedades invisíveis para o chamador.
    if (!(key in next)) return;
    const v = String(value ?? '').trim();
    if (!v) return;
    const current = mutable[key];
    if (typeof current === 'string' && current.trim()) return;
    mutable[key] = v;
    changed = true;
  };
  if (rem) {
    set('remitterName', rem.company_name || rem.legal_name);
    set('remitterCnpj', digitsOnly(rem.tax_id));
    set('remitterIe', sanitizeIe(rem.state_registration));
    set('remitterStreet', rem.address_street);
    set('remitterNumber', rem.address_number);
    set('remitterNeighborhood', rem.address_neighborhood);
    set('remitterZip', rem.address_zip);
  }
  if (rec) {
    set('recipientName', rec.company_name || rec.legal_name);
    set('recipientCnpj', digitsOnly(rec.tax_id));
    set('recipientIe', sanitizeIe(rec.state_registration));
    set('recipientCity', rec.address_city);
    set('recipientState', rec.address_state);
    set('recipientStreet', rec.address_street);
    set('recipientNumber', rec.address_number);
    set('recipientNeighborhood', rec.address_neighborhood);
    set('recipientZip', rec.address_zip);
    set('recipientCityIbge', rec.address_city_ibge_code);
  }
  // Limpa marcadores inválidos ('UNKNOWN') que possam ter vindo do cadastro/RPC.
  for (const key of ['remitterIe', 'recipientIe'] as const) {
    const currentValue = mutable[key];
    const current = typeof currentValue === 'string' ? currentValue.trim() : '';
    if (!current) continue;
    const state = key === 'recipientIe' ? next.recipientState || rec?.address_state : String(mutable.remitterState || rem?.address_state || '');
    const clean = restoreStateRegistrationLeadingZeros(current, state) ?? sanitizeIe(current) ?? '';
    if (clean !== current) {
      mutable[key] = clean;
      changed = true;
    }
  }
  return { item: changed ? next : item, changed };
}
