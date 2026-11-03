import { calculateNfeAccessKeyCheckDigit } from '@/lib/fiscalDocuments/nfeAccessKey';
import type { ContractorCte } from '@/lib/ingestion/contractorCte';
const base = '3126111234567800019557001000000123100000001';
export const contractorKey = base + calculateNfeAccessKeyCheckDigit(base);
export const contractorFixture: ContractorCte = {
  access_key: contractorKey, number: '123', series: '1', issue_date: '2026-11-03', environment: 'production',
  issuer_name: 'Transportadora sintética QA', issuer_cnpj: '12345678000195', issuer_ie: '123456789', issuer_state: 'MG',
  issuer_address: { street: 'Rua QA', number: '1', neighborhood: 'Centro', city: 'Montes Claros', city_code: '3143302', state: 'MG', zip: '39400000' },
  origin_city_code: '3143302', destination_city_code: '3550308', referenced_nfe_keys: [],
  source_format: 'pdf', authorization_declared: false, authorization_protocol: null,
};
