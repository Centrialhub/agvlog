import type { FiscalDocument } from '@/hooks/useFiscalDocuments';
import type { RegistryClient } from './partyRegistry';
import { sanitizeIe } from './partyRegistry';
import { fiscalDocumentText } from './fiscalDocumentContact';
import { onlyDigits, normalizeCpfCnpj, normalizeCep, normalizeUf, normalizeIbgeCity, normalizeCityName, normalizePhone } from './fiscalAddress';

export interface TomadorData {
  nome: string;
  cnpj: string;
  ie: string;
  im: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  email: string;
  telefone: string;
  municipio: string;
  municipio_cod: string;
  uf: string;
  cep: string;
  cliente_id: string | null;
}


type Client = RegistryClient & {municipal_registration?: string | null; email?: string | null; phone?: string | null};
/** Never combine the payer CNPJ with the other party's address or registration. */
export function resolveNFSeTomador(document: FiscalDocument, mode: 'remetente' | 'destinatario', clients: Client[]): TomadorData {
 const prefix=mode==='remetente'?'remitter':'recipient';
 const field=(...names:string[])=>fiscalDocumentText(document,...names.map(name=>prefix+'_'+name));
 const cnpj=onlyDigits(field('cnpj'));
 const match=normalizeCpfCnpj(cnpj)?clients.find(client=>onlyDigits(client.tax_id)===cnpj):undefined;
 const municipio=match?.address_city||field('city');
 return {
  nome:match?.company_name||(mode==='remetente'?document.remitter:document.recipient)||'',cnpj,
  ie:sanitizeIe(match?.state_registration||field('ie','state_registration'))||'',im:match?.municipal_registration||field('im'),
  endereco:match?.address_street||field('address'),numero:match?.address_number||field('number'),
  complemento:match?.address_complement||field('complement'),bairro:match?.address_neighborhood||field('neighborhood'),
  email:match?.email||field('email'),telefone:normalizePhone(match?.phone||field('phone'))||'',
  municipio:normalizeCityName(municipio)||'',municipio_cod:normalizeIbgeCity(match?.address_city_ibge_code)||normalizeIbgeCity(field('cod_municipio','city_code','city_ibge_code'))||normalizeIbgeCity(municipio)||'',
  uf:normalizeUf(match?.address_state||field('state'))||'',cep:normalizeCep(match?.address_zip||field('zip','address_zip'))||'',cliente_id:match?.id||null,
 };
}
