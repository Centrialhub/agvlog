import type { OfficialTaxProfile } from './taxRegistryClient';
import type { TomadorData } from './nfseTomador';
import { sanitizeIe } from './partyRegistry';
import {
  normalizeCep,
  normalizeCityName,
  normalizeCpfCnpj,
  normalizeIbgeCity,
  normalizeUf,
} from './fiscalAddress';

export const NFSE_TOMADOR_REQUIRED_LABELS = {
  cnpj: 'CNPJ/CPF válido do tomador',
  nome: 'Razão social do tomador',
  endereco: 'Logradouro do tomador',
  bairro: 'Bairro do tomador',
  municipio: 'Município do tomador',
  municipioCod: 'Código IBGE do município do tomador',
  uf: 'UF do tomador',
  cep: 'CEP do tomador',
} as const;

function onlyDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function findActiveNFSeTaxProfile(
  cnpj: string,
  profiles: OfficialTaxProfile[],
): OfficialTaxProfile | null {
  const normalized = onlyDigits(cnpj);
  return profiles.find(profile =>
    onlyDigits(profile.cnpj) === normalized && profile.registry_status === 'active'
  ) || null;
}

export function missingNFSeTomadorFields(party: TomadorData | null | undefined): string[] {
  if (!party) return Object.values(NFSE_TOMADOR_REQUIRED_LABELS);
  const missing: string[] = [];
  if (!normalizeCpfCnpj(party.cnpj)) missing.push(NFSE_TOMADOR_REQUIRED_LABELS.cnpj);
  if (!party.nome.trim()) missing.push(NFSE_TOMADOR_REQUIRED_LABELS.nome);
  if (!party.endereco.trim()) missing.push(NFSE_TOMADOR_REQUIRED_LABELS.endereco);
  if (!party.bairro.trim()) missing.push(NFSE_TOMADOR_REQUIRED_LABELS.bairro);
  if (!normalizeCityName(party.municipio)) missing.push(NFSE_TOMADOR_REQUIRED_LABELS.municipio);
  if (!normalizeIbgeCity(party.municipio_cod)) missing.push(NFSE_TOMADOR_REQUIRED_LABELS.municipioCod);
  if (!normalizeUf(party.uf)) missing.push(NFSE_TOMADOR_REQUIRED_LABELS.uf);
  if (!normalizeCep(party.cep)) missing.push(NFSE_TOMADOR_REQUIRED_LABELS.cep);
  return missing;
}

/**
 * Mesmo com o endereco completo, CNPJ sem IE precisa passar pelo cadastro
 * oficial antes da criacao do rascunho. Isso evita que um lote avance e pare
 * somente ao chegar a uma nota cuja IE nao veio no XML/cadastro local.
 */
export function needsNFSeTomadorRegistryEnrichment(
  party: TomadorData | null | undefined,
): boolean {
  if (!party) return true;
  const cnpj = onlyDigits(party.cnpj);
  return missingNFSeTomadorFields(party).length > 0
    || (cnpj.length === 14 && !sanitizeIe(party.ie));
}

/** Completes only absent fields, preserving values already reviewed by the user. */
export function mergeOfficialProfileIntoNFSeTomador(
  current: TomadorData,
  profile: OfficialTaxProfile,
  fallbackUf = '',
): TomadorData {
  const address = profile.official_address;
  return {
    ...current,
    nome: current.nome || profile.legal_name || profile.trade_name || '',
    cnpj: normalizeCpfCnpj(current.cnpj) || normalizeCpfCnpj(profile.cnpj) || current.cnpj,
    ie: current.ie || profile.state_registration || '',
    endereco: current.endereco || address.street || '',
    numero: current.numero || address.number || '',
    complemento: current.complemento || address.complement || '',
    bairro: current.bairro || address.neighborhood || '',
    municipio: normalizeCityName(current.municipio || address.city) || '',
    municipio_cod: normalizeIbgeCity(current.municipio_cod || address.cityCode) || '',
    uf: normalizeUf(current.uf || address.state || profile.uf || fallbackUf) || '',
    cep: normalizeCep(current.cep || address.zip) || '',
  };
}

interface ViaCepAddress {
  erro?: boolean | string;
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  ibge?: string;
}

type AddressFetcher = (input: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

function comparableAddressText(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\b(RUA|R|AVENIDA|AV|RODOVIA|ROD)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ').trim();
}

function matchesTomadorMunicipality(address: ViaCepAddress, party: TomadorData): boolean {
  const expectedIbge = normalizeIbgeCity(party.municipio_cod);
  const actualIbge = normalizeIbgeCity(address.ibge);
  return normalizeUf(address.uf) === normalizeUf(party.uf)
    && (!expectedIbge || actualIbge === expectedIbge)
    && comparableAddressText(address.localidade) === comparableAddressText(party.municipio);
}

function applyViaCepAddress(party: TomadorData, address: ViaCepAddress): TomadorData {
  return {
    ...party,
    endereco: String(address.logradouro || party.endereco).trim(),
    bairro: String(address.bairro || party.bairro).trim(),
    municipio: normalizeCityName(address.localidade || party.municipio) || party.municipio,
    municipio_cod: normalizeIbgeCity(address.ibge) || party.municipio_cod,
    uf: normalizeUf(address.uf) || party.uf,
    cep: normalizeCep(address.cep) || party.cep,
  };
}

/**
 * Confirms the postal code against ViaCEP before a production NFS-e draft is
 * created. When a registry returns a retired/invalid ZIP, search the same
 * street + municipality and replace it only with an unambiguous IBGE match.
 */
export async function canonicalizeNFSeTomadorPostalAddress(
  party: TomadorData,
  fetcher: AddressFetcher = async input => fetch(input),
): Promise<TomadorData> {
  const cep = normalizeCep(party.cep);
  const uf = normalizeUf(party.uf);
  const city = normalizeCityName(party.municipio);
  const street = String(party.endereco || '').trim();
  if (!cep || !uf || !city || street.length < 3) {
    throw new Error('Endereço do tomador incompleto para validação postal.');
  }

  const exactResponse = await fetcher(`https://viacep.com.br/ws/${cep}/json/`);
  if (!exactResponse.ok) throw new Error('Não foi possível validar o CEP do tomador.');
  const exact = await exactResponse.json() as ViaCepAddress;
  if (!exact.erro && matchesTomadorMunicipality(exact, party)) return applyViaCepAddress(party, exact);

  const searchResponse = await fetcher(
    `https://viacep.com.br/ws/${encodeURIComponent(uf)}/${encodeURIComponent(city)}/${encodeURIComponent(street)}/json/`,
  );
  if (!searchResponse.ok) throw new Error('Não foi possível localizar um CEP válido para o endereço do tomador.');
  const candidates = await searchResponse.json() as ViaCepAddress[];
  const streetKey = comparableAddressText(street);
  const matches = (Array.isArray(candidates) ? candidates : []).filter(address =>
    matchesTomadorMunicipality(address, party)
    && comparableAddressText(address.logradouro).includes(streetKey),
  );
  if (matches.length !== 1) {
    throw new Error('CEP do tomador não pertence ao município informado e não foi possível corrigi-lo de forma inequívoca.');
  }
  return applyViaCepAddress(party, matches[0]);
}
