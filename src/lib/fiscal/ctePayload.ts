import type { Json } from '@/integrations/supabase/types';

type JsonObject = { [key: string]: Json | undefined };

function asObject(value: Json | null | undefined): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

function asText(value: Json | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asNumber(value: Json | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export type CteTakerRole = 'remetente' | 'destinatario' | 'expedidor' | 'recebedor' | 'terceiro';

export interface CteMdfeParty {
  name: string | null;
  taxId: string | null;
  stateRegistration: string | null;
  street: string | null;
  number: string | null;
  neighborhood: string | null;
  city: string | null;
  cityIbge: string | null;
  state: string | null;
  zip: string | null;
}

export interface CteMdfeDetails {
  cargoValue: number | null;
  predominantProduct: string | null;
  takerRole: CteTakerRole | null;
  taker: CteMdfeParty | null;
  insuranceEndorsements: string[];
}

const TAKER_ROLES = new Set<CteTakerRole>([
  'remetente', 'destinatario', 'expedidor', 'recebedor', 'terceiro',
]);

function readMdfeParty(value: Json | null | undefined): CteMdfeParty | null {
  const party = asObject(value);
  if (!party) return null;
  const address = asObject(party.endereco);
  const cnpj = asText(party.cnpj)?.replace(/\D/g, '') || '';
  const cpf = asText(party.cpf)?.replace(/\D/g, '') || '';
  const name = asText(party.nome) ?? asText(party.xNome);
  const taxId = cnpj || cpf || null;
  if (!name && !taxId) return null;

  return {
    name,
    taxId,
    stateRegistration: asText(party.ie) ?? asText(party.IE),
    street: asText(address?.logradouro) ?? asText(address?.xLgr),
    number: asText(address?.numero) ?? asText(address?.nro),
    neighborhood: asText(address?.bairro) ?? asText(address?.xBairro),
    city: asText(address?.municipio) ?? asText(address?.xMun),
    cityIbge: asText(address?.cMun) ?? asText(address?.codigoMunicipio),
    state: asText(address?.uf) ?? asText(address?.UF),
    zip: asText(address?.cep) ?? asText(address?.CEP),
  };
}

/** Extracts the immutable CT-e data required to compose an MDF-e. */
export function readCteMdfeDetails(
  value: Json | null | undefined,
  storedTakerRole?: string | null,
): CteMdfeDetails {
  const root = asObject(value);
  const payload = asObject(root?.payload) ?? root;
  const takerBlock = asObject(payload?.tomador);
  const rawRole = String(storedTakerRole || asText(takerBlock?.role) || '').toLowerCase();
  const takerRole = TAKER_ROLES.has(rawRole as CteTakerRole) ? rawRole as CteTakerRole : null;

  const partyKey = takerRole === 'remetente'
    ? 'remetente'
    : takerRole === 'destinatario'
      ? 'destinatario'
      : takerRole === 'expedidor'
        ? 'expedidor'
        : takerRole === 'recebedor'
          ? 'recebedor'
          : null;
  const taker = takerRole === 'terceiro'
    ? readMdfeParty(takerBlock?.dados)
    : partyKey
      ? readMdfeParty(payload?.[partyKey])
      : null;

  const values = asObject(payload?.valores);
  const merchandise = asObject(payload?.mercadoria);
  const predominantProductBlock = asObject(payload?.produtoPredominante);
  const insurance = asObject(payload?.seguro) ?? asObject(payload?.seguradora);
  const rawEndorsements = insurance?.nAver;
  const insuranceEndorsements = Array.isArray(rawEndorsements)
    ? rawEndorsements.flatMap(item => typeof item === 'string' && item.trim() ? [item.trim()] : [])
    : [asText(insurance?.averbacao)].filter((item): item is string => Boolean(item));

  return {
    cargoValue: asNumber(values?.valorCarga) ?? asNumber(payload?.vCarga),
    predominantProduct: asText(merchandise?.produto)
      ?? asText(merchandise?.content)
      ?? asText(predominantProductBlock?.descricao),
    takerRole,
    taker,
    insuranceEndorsements: [...new Set(insuranceEndorsements)],
  };
}

export interface CtePayloadRecipient {
  name: string | null;
  city: string | null;
  state: string | null;
}

export interface AuthorizedCteHubDetails {
  accessKey: string | null;
  remitter: {
    stateRegistration: string | null;
    street: string | null;
    number: string | null;
    neighborhood: string | null;
    city: string | null;
    cityIbge: string | null;
    state: string | null;
    zip: string | null;
  };
}

export function readCtePayloadRecipient(value: Json | null | undefined): CtePayloadRecipient {
  const root = asObject(value);
  const payload = asObject(root?.payload);
  const recipient = asObject(payload?.destinatario);
  const destination = asObject(payload?.fim);
  const address = asObject(recipient?.endereco);

  return {
    name: asText(recipient?.nome),
    city: asText(destination?.municipio) ?? asText(address?.municipio),
    state: asText(destination?.uf) ?? asText(address?.uf),
  };
}

export function readAuthorizedCteHubDetails(value: Json | null | undefined): AuthorizedCteHubDetails {
  const root = asObject(value);
  const document = asObject(root?.document);
  const payload = asObject(root?.payload) ?? asObject(document?.payload);
  const remitter = asObject(payload?.remetente) ?? asObject(payload?.rem);
  const address = asObject(remitter?.endereco);

  return {
    accessKey: asText(document?.access_key) ?? asText(document?.accessKey),
    remitter: {
      stateRegistration: asText(remitter?.ie),
      street: asText(address?.logradouro),
      number: asText(address?.numero),
      neighborhood: asText(address?.bairro),
      city: asText(address?.municipio),
      cityIbge: asText(address?.cMun) ?? asText(address?.codigoMunicipio),
      state: asText(address?.uf),
      zip: asText(address?.cep) ?? asText(address?.CEP),
    },
  };
}

/** Read the immutable source NF numbers, independent of later release/cancellation links. */
export function readCtePayloadInvoiceNumbers(value: Json | null | undefined): string | null {
  const root = asObject(value);
  const payload = asObject(root?.payload) ?? root;
  const invoices = payload?.notasFiscais;
  if (!Array.isArray(invoices)) return null;
  const numbers = invoices.flatMap(invoice => {
    const raw = asObject(invoice)?.numero;
    const number = typeof raw === 'number' ? String(raw) : asText(raw);
    return number ? [number.trim()] : [];
  });
  return [...new Set(numbers)].join(', ') || null;
}
