import { decryptFiscalCredential } from './fiscal-credential-crypto.ts';

export type RegistryEnvironment = 'production' | 'homologation';
export type LookupType = 'CNPJ' | 'CPF' | 'IE';

export interface OfficialAddress {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  cityCode: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface OfficialRegistryRecord {
  cnpj: string;
  stateRegistration: string | null;
  legalName: string | null;
  tradeName: string | null;
  registryStatus: string;
  statusCode: string | null;
  taxRegime: string | null;
  economicActivityCode: string | null;
  address: OfficialAddress;
  raw: Record<string, string | null>;
}

const DEFAULT_ENDPOINTS: Record<string, { production: string; homologation: string }> = {
  MG: {
    production: 'https://nfe.fazenda.mg.gov.br/nfe2/services/CadConsultaCadastro4',
    homologation: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/CadConsultaCadastro4',
  },
};

export function registryEndpoint(uf: string, environment: RegistryEnvironment): string {
  const normalized = uf.trim().toUpperCase();
  const configured = runtimeEnv('SEFAZ_CADASTRO_ENDPOINTS_JSON');
  if (configured) {
    try {
      const endpoints = JSON.parse(configured) as Record<string, Partial<Record<RegistryEnvironment, string>>>;
      const endpoint = endpoints[normalized]?.[environment];
      if (endpoint) return endpoint;
    } catch {
      throw new Error('SEFAZ_CADASTRO_ENDPOINTS_JSON inválido');
    }
  }
  const endpoint = DEFAULT_ENDPOINTS[normalized]?.[environment];
  if (!endpoint) throw new Error('UF_SEM_ENDPOINT_CADASTRO_CONFIGURADO');
  return endpoint;
}

export function digits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function buildCadastroEnvelope(uf: string, lookupType: LookupType, lookupValue: string): string {
  const value = escapeXml(lookupValue);
  return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4">
      <ConsCad xmlns="http://www.portalfiscal.inf.br/nfe" versao="2.00">
        <infCons>
          <xServ>CONS-CAD</xServ>
          <UF>${escapeXml(uf.toUpperCase())}</UF>
          <${lookupType}>${value}</${lookupType}>
        </infCons>
      </ConsCad>
    </nfeDadosMsg>
  </soap12:Body>
</soap12:Envelope>`;
}

export function parseCadastroResponse(xml: string): {
  cStat: number | null;
  reason: string | null;
  records: OfficialRegistryRecord[];
} {
  const payload = decodeXmlEntities(xml);
  const cStatText = readTag(payload, 'cStat');
  const reason = readTag(payload, 'xMotivo');
  const blocks = [...payload.matchAll(/<(?:[A-Za-z0-9_]+:)?infCad(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?infCad>/gi)]
    .map(match => match[1]);

  const records = blocks.map(block => {
    const cnpj = digits(readTag(block, 'CNPJ'));
    const statusCode = readTag(block, 'cSit');
    return {
      cnpj,
      stateRegistration: clean(readTag(block, 'IE')),
      legalName: clean(readTag(block, 'xNome')),
      tradeName: clean(readTag(block, 'xFant')),
      registryStatus: statusCode === '1' ? 'active' : statusCode === '0' ? 'inactive' : 'unknown',
      statusCode: clean(statusCode),
      taxRegime: clean(readTag(block, 'regApur')),
      economicActivityCode: clean(readTag(block, 'CNAE')),
      address: {
        street: clean(readTag(block, 'xLgr')),
        number: clean(readTag(block, 'nro')),
        complement: clean(readTag(block, 'xCpl')),
        neighborhood: clean(readTag(block, 'xBairro')),
        cityCode: clean(readTag(block, 'cMun')),
        city: clean(readTag(block, 'xMun')),
        state: clean(readTag(block, 'UF')),
        zip: digits(readTag(block, 'CEP')) || null,
      },
      raw: {
        cSit: clean(statusCode),
        dIniAtiv: clean(readTag(block, 'dIniAtiv')),
        dUltSit: clean(readTag(block, 'dUltSit')),
        indCredNFe: clean(readTag(block, 'indCredNFe')),
        indCredCTe: clean(readTag(block, 'indCredCTe')),
      },
    };
  }).filter(record => record.cnpj.length === 14);

  return { cStat: cStatText && /^\d+$/.test(cStatText) ? Number(cStatText) : null, reason, records };
}

export async function readCertificateBundle(ciphertext: string): Promise<{ certificatePem: string; privateKeyPem: string }> {
  const encryptionKey = runtimeEnv('AGVLOG_ENCRYPTION_KEY') || '';
  if (!encryptionKey) throw new Error('AGVLOG_ENCRYPTION_KEY não configurada');
  const plaintext = await decryptFiscalCredential(ciphertext, encryptionKey);
  const bundle = JSON.parse(plaintext) as { certificatePem?: unknown; privateKeyPem?: unknown };
  if (typeof bundle.certificatePem !== 'string' || typeof bundle.privateKeyPem !== 'string') {
    throw new Error('CERTIFICATE_BUNDLE_INVALID');
  }
  return { certificatePem: bundle.certificatePem, privateKeyPem: bundle.privateKeyPem };
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string'
    ? new TextEncoder().encode(value)
    : Uint8Array.from(value);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

function readTag(xml: string, tag: string): string | null {
  const escaped = tag.replace(/[.*+?^{}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<(?:[A-Za-z0-9_]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${escaped}>`, 'i').exec(xml);
  return match ? stripMarkup(match[1]).trim() : null;
}

function stripMarkup(value: string): string {
  return value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(/<[^>]*>/g, '');
}

function clean(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function decodeXmlEntities(value: string): string {
  let current = value;
  for (let i = 0; i < 2; i++) {
    current = current.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  return current;
}


function runtimeEnv(name: string): string | undefined {
  return (globalThis as typeof globalThis & { Deno?: { env: { get(key: string): string | undefined } } }).Deno?.env.get(name);
}
