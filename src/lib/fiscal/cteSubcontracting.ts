import type { ContractorCteSource } from '@/lib/ingestion/contractorCteRepository';
import { contractorCteSchema } from '@/lib/ingestion/contractorCte';
import type { CteParty } from './cteBuilder';

export interface CteSubcontractingSelection {
  source: ContractorCteSource;
  originName: string;
  destinationName: string;
  confirmed: boolean;
}
const STATES: Record<string, string> = {
  '11':'RO','12':'AC','13':'AM','14':'RR','15':'PA','16':'AP','17':'TO','21':'MA','22':'PI','23':'CE','24':'RN','25':'PB','26':'PE','27':'AL','28':'SE','29':'BA','31':'MG','32':'ES','33':'RJ','35':'SP','41':'PR','42':'SC','43':'RS','50':'MS','51':'MT','52':'GO','53':'DF',
};
export const stateFromCteCity = (code: string) => STATES[code.slice(0, 2)] || '';
export function contractorAsTaker(selection: CteSubcontractingSelection): CteParty {
  const d = selection.source.document;
  return { name: d.issuer_name, cnpj: d.issuer_cnpj, ie: d.issuer_ie, address: {
    ...d.issuer_address, city_ibge: d.issuer_address.city_code,
  } };
}
export function validateCteSubcontracting(selection: CteSubcontractingSelection | null | undefined, environment: string | undefined, emitterCnpj: string, keys: string[]) {
  const missing: string[] = [];
  if (!selection) return ['CT-e da contratante'];
  const { source, originName, destinationName, confirmed } = selection;
  const parsed = contractorCteSchema.safeParse(source.document);
  if (!parsed.success || source.access_key !== source.document.access_key || source.environment !== source.document.environment || !/^[a-f0-9]{64}$/.test(source.original_sha256)) return ['Cadastro válido do CT-e da contratante'];
  const d = parsed.data;
  const expected = environment === 'production' ? 'production' : 'homologation';
  if (d.environment !== expected) missing.push('CT-e da contratante no mesmo ambiente da emissão');
  if (d.issuer_cnpj === emitterCnpj.replace(/\D/g, '')) missing.push('Contratante diferente do emitente');
  if (!originName.trim() || !destinationName.trim() || !stateFromCteCity(d.origin_city_code) || !stateFromCteCity(d.destination_city_code)) missing.push('Municípios de início e fim do CT-e original');
  if (!confirmed) missing.push('Conferência do CT-e original e da situação fiscal');
  if (d.referenced_nfe_keys.length && keys.some(key => !d.referenced_nfe_keys.includes(key))) missing.push('NFs pertencentes ao CT-e original');
  return missing;
}
