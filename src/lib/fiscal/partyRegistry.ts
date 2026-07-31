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
  address_street?: string | null;
  address_number?: string | null;
  address_complement?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  [k: string]: any;
}

export interface PartyAddress {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface ResolvedParty {
  name: string;
  cnpj: string | null;
  ie: string | null;
  address: PartyAddress | null;
}

export const digitsOnly = (v?: string | null) => (v || '').replace(/\D+/g, '');

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

/** Acha o cadastro correspondente à parte (id > CNPJ > nome). */
export function findRegistryClient(
  index: ClientIndex,
  party: { id?: string | null; cnpj?: string | null; name?: string | null },
): RegistryClient | null {
  if (party.id && index.byId.has(String(party.id))) return index.byId.get(String(party.id))!;
  const k = digitsOnly(party.cnpj);
  if (k && index.byCnpj.has(k)) return index.byCnpj.get(k)!;
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
  fallbackAddress?: { city?: string | null; state?: string | null } | null,
): ResolvedParty | null {
  const c = findRegistryClient(index, party);
  const name = (party.name || '').trim() || (c?.company_name || c?.legal_name || '').trim();
  if (!name) return null;
  const cnpj = digitsOnly(party.cnpj) || digitsOnly(c?.tax_id) || null;
  const ie = (party.ie || '').trim() || (c?.state_registration ? String(c.state_registration) : null);
  const fromClient = addressFromClient(c);
  const fallback: PartyAddress | null = fallbackAddress
    ? {
        street: null,
        number: null,
        complement: null,
        neighborhood: null,
        city: fallbackAddress.city || null,
        state: fallbackAddress.state || null,
        zip: null,
      }
    : null;
  // Mescla: cadastro preenche o que o fallback (dados da NF) não tem e vice-versa.
  const address =
    fromClient && fallback
      ? {
          ...fromClient,
          city: fromClient.city || fallback.city,
          state: fromClient.state || fallback.state,
        }
      : fromClient || fallback;
  return { name, cnpj, ie, address };
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
  let changed = false;
  const set = (key: keyof T, value?: string | null) => {
    const v = (value ?? '') === null ? '' : String(value ?? '').trim();
    if (!v) return;
    if (((next[key] as unknown as string) || '').trim()) return;
    (next[key] as unknown as string) = v;
    changed = true;
  };
  if (rem) {
    set('remitterName' as keyof T, rem.company_name || rem.legal_name);
    set('remitterCnpj' as keyof T, digitsOnly(rem.tax_id));
    set('remitterIe' as keyof T, rem.state_registration);
  }
  if (rec) {
    set('recipientName' as keyof T, rec.company_name || rec.legal_name);
    set('recipientCnpj' as keyof T, digitsOnly(rec.tax_id));
    set('recipientIe' as keyof T, rec.state_registration);
    set('recipientCity' as keyof T, rec.address_city);
    set('recipientState' as keyof T, rec.address_state);
  }
  return { item: changed ? next : item, changed };
}