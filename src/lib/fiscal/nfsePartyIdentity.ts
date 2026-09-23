import type { TomadorData } from '@/lib/fiscal/nfseTomador';
import { normalizeCep, normalizeIbgeCity } from '@/lib/fiscal/fiscalAddress';
import { onlyDigits } from '@/lib/fiscal/insuranceValidation';

export function normalizedPartyIdentity(party: TomadorData): string {
  return [
    onlyDigits(party.cnpj),
    String(party.nome || '').trim().toLocaleUpperCase('pt-BR'),
    onlyDigits(party.ie),
    String(party.endereco || '').trim().toLocaleUpperCase('pt-BR'),
    String(party.numero || '').trim().toLocaleUpperCase('pt-BR'),
    normalizeCep(party.cep),
    normalizeIbgeCity(party.municipio_cod) || String(party.municipio || '').trim().toLocaleUpperCase('pt-BR'),
    String(party.uf || '').trim().toLocaleUpperCase('pt-BR'),
  ].join('|');
}
