import { z } from 'zod';
import { isValidNfeAccessKey } from '@/lib/fiscalDocuments/nfeAccessKey';
import { readBlobBytes } from '@/lib/uploadPolicy';

export const CONTRACTOR_CTE_MAX_BYTES = 10 * 1024 * 1024;
const digits = (value: string) => value.replace(/\D/g, '');
export const contractorCteKeySchema = z.string().trim().regex(/^\d{44}$/, 'Informe a chave de 44 dígitos do CT-e.')
  .refine(value => value.slice(20, 22) === '57' && isValidNfeAccessKey(value), 'Chave de CT-e modelo 57 inválida.');
const addressSchema = z.object({
  street: z.string(), number: z.string(), neighborhood: z.string(), city: z.string(),
  city_code: z.string(), state: z.string(), zip: z.string(),
}).strict();
export const contractorCteSchema = z.object({
  access_key: contractorCteKeySchema,
  number: z.string().regex(/^\d{1,9}$/), series: z.string().regex(/^\d{1,3}$/),
  issue_date: z.string().date(),
  environment: z.enum(['production', 'homologation']),
  issuer_name: z.string().trim().min(1).max(255),
  issuer_cnpj: z.string().regex(/^\d{14}$/), issuer_ie: z.string().trim().min(1).max(20),
  issuer_state: z.string().regex(/^[A-Z]{2}$/), issuer_address: addressSchema,
  origin_city_code: z.string().regex(/^\d{7}$/), destination_city_code: z.string().regex(/^\d{7}$/),
  referenced_nfe_keys: z.array(z.string().regex(/^\d{44}$/)).max(2000),
  authorization_protocol: z.string().max(20).nullable(),
  authorization_declared: z.boolean(),
  source_format: z.enum(['xml', 'pdf']),
}).strict().superRefine((value, ctx) => {
  const mismatch = value.access_key.slice(6, 20) !== value.issuer_cnpj
    || Number(value.access_key.slice(22, 25)) !== Number(value.series)
    || Number(value.access_key.slice(25, 34)) !== Number(value.number);
  if (mismatch) ctx.addIssue({ code: 'custom', message: 'A chave não corresponde ao emitente, número ou série informados.' });
  if (value.source_format === 'pdf' && (value.authorization_declared || value.authorization_protocol !== null)) {
    ctx.addIssue({ code: 'custom', message: 'O PDF/DACTE não comprova a autorização do XML.' });
  }
});
export type ContractorCte = z.infer<typeof contractorCteSchema>;

export function cteIdentityFromKey(value: string) {
  const access_key = contractorCteKeySchema.parse(digits(value));
  return { access_key, issuer_cnpj: access_key.slice(6, 20),
    number: String(Number(access_key.slice(25, 34))), series: String(Number(access_key.slice(22, 25))) };
}

const NS = 'http://www.portalfiscal.inf.br/cte';
function child(parent: Element, name: string, optional = false): Element | null {
  const matches = Array.from(parent.children).filter(el => el.namespaceURI === NS && el.localName === name);
  if (matches.length > 1 || (!optional && matches.length !== 1)) throw new Error(`XML CT-e: campo ${name} ausente ou repetido.`);
  return matches[0] ?? null;
}
function text(parent: Element, name: string, optional = false) {
  return child(parent, name, optional)?.textContent?.trim() ?? '';
}

/** Reads only the original CT-e namespace. An envelope is not signature or live SEFAZ verification. */
export function parseContractorCteXml(source: string): ContractorCte {
  if (!source.trim() || new TextEncoder().encode(source).length > CONTRACTOR_CTE_MAX_BYTES) throw new Error('XML vazio ou maior que 10 MB.');
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('XML com declaração de entidade não é permitido.');
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML de CT-e malformado.');
  const root = doc.documentElement;
  if (root.namespaceURI !== NS || !['cteProc', 'CTe'].includes(root.localName)) throw new Error('Selecione um XML de CT-e modelo 57.');
  const cte = root.localName === 'CTe' ? root : child(root, 'CTe')!;
  const info = child(cte, 'infCte')!, ide = child(info, 'ide')!, emit = child(info, 'emit')!;
  if (text(ide, 'mod') !== '57') throw new Error('Este fluxo aceita somente CT-e modelo 57.');
  const id = info.getAttribute('Id') ?? '';
  if (!/^CTe\d{44}$/.test(id)) throw new Error('Identificador fiscal do CT-e inválido.');
  const access_key = id.slice(3);
  const address = child(emit, 'enderEmit')!;
  const protocol = root.localName === 'cteProc' ? child(root, 'protCTe', true) : null;
  const receipt = protocol ? child(protocol, 'infProt') : null;
  const environmentCode = text(ide, 'tpAmb');
  if (!['1', '2'].includes(environmentCode)) throw new Error('Ambiente fiscal do CT-e inválido.');
  if (receipt && (text(receipt, 'chCTe') !== access_key || text(receipt, 'tpAmb') !== environmentCode
    || text(receipt, 'cStat') !== '100' || !/^\d{15}$/.test(text(receipt, 'nProt')))) {
    throw new Error('O protocolo do XML não corresponde a um CT-e autorizado neste ambiente.');
  }
  const normal = child(info, 'infCTeNorm', true), docs = normal ? child(normal, 'infDoc', true) : null;
  const references = docs ? Array.from(docs.children).filter(el => el.namespaceURI === NS && el.localName === 'infNFe')
    .map(el => text(el, 'chave')) : [];
  if (references.some(key => !isValidNfeAccessKey(key) || key.slice(20, 22) !== '55')) throw new Error('O XML contém referência de NF-e inválida.');
  const uf = text(address, 'UF');
  return contractorCteSchema.parse({
    access_key, number: text(ide, 'nCT'), series: text(ide, 'serie'), issue_date: text(ide, 'dhEmi').slice(0, 10),
    environment: environmentCode === '1' ? 'production' : 'homologation',
    issuer_name: text(emit, 'xNome'), issuer_cnpj: text(emit, 'CNPJ'), issuer_ie: text(emit, 'IE'), issuer_state: uf,
    issuer_address: { street: text(address, 'xLgr'), number: text(address, 'nro'), neighborhood: text(address, 'xBairro'),
      city: text(address, 'xMun'), city_code: text(address, 'cMun'), state: uf, zip: text(address, 'CEP', true) },
    origin_city_code: text(ide, 'cMunIni'), destination_city_code: text(ide, 'cMunFim'),
    referenced_nfe_keys: [...new Set(references)], authorization_protocol: receipt ? text(receipt, 'nProt') : null,
    authorization_declared: Boolean(receipt), source_format: 'xml',
  });
}

export async function describeContractorCteFile(file: File) {
  if (!file.size || file.size > CONTRACTOR_CTE_MAX_BYTES) throw new Error('Envie um XML ou PDF de até 10 MB.');
  const bytes = await readBlobBytes(file);
  const extension = file.name.split('.').pop()?.toLowerCase();
  const prefix = new TextDecoder().decode(bytes.slice(0, 2048)).replace(/^\uFEFF/, '').trimStart();
  if (extension === 'pdf' ? !prefix.startsWith('%PDF-') : extension !== 'xml' || !prefix.startsWith('<')) {
    throw new Error('O conteúdo deve corresponder a um arquivo XML ou PDF/DACTE.');
  }
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return { format: extension as 'xml' | 'pdf', sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''), size: bytes.length };
}
