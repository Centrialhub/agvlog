// NFe / NFSe XML parser — client-side, no external deps.
// Extracts the fields needed to auto-fill payables/receivables forms.

export type ParsedFiscalXml = {
  kind: 'nfe' | 'nfse' | 'unknown';
  document_number: string | null;       // nº nota / RPS
  access_key: string | null;             // chNFe (44 dígitos) — apenas NFe
  series: string | null;
  issue_date: string | null;             // YYYY-MM-DD
  amount: number | null;                 // valor total
  emitter: { name: string | null; tax_id: string | null };
  recipient: { name: string | null; tax_id: string | null };
  installments: Array<{ number: string | null; due_date: string | null; amount: number | null }>;
  first_due_date: string | null;
  description: string | null;
};

function descendants(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((element) => element.localName === localName);
}

function text(node: Element | null | undefined, tag: string): string | null {
  if (!node) return null;
  return descendants(node, tag)[0]?.textContent?.trim() || null;
}

function findFirst(root: Document | Element, tags: string[]): Element | null {
  for (const t of tags) {
    const el = descendants(root, t)[0];
    if (el) return el;
  }
  return null;
}

function normalizeDate(v: string | null): string | null {
  if (!v) return null;
  // Accepts 2026-01-15T10:00:00-03:00, 2026-01-15, 15/01/2026
  const iso = v.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

function toNumber(v: string | null): number | null {
  if (!v) return null;
  const numeric = v.trim().replace(/[^0-9,.-]/g, '');
  if (!numeric) return null;
  const lastComma = numeric.lastIndexOf(',');
  const lastDot = numeric.lastIndexOf('.');
  let clean: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? /\./g : /,/g;
    clean = numeric.replace(thousands, '').replace(decimal, '.');
  } else if (lastComma >= 0) {
    clean = numeric.replace(/\./g, '').replace(',', '.');
  } else {
    // XML Schema decimals use a dot. Do not interpret it as a thousands
    // separator: doing so multiplied every NF-e/NFS-e amount by 100.
    clean = numeric.replace(/,/g, '');
  }
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

function cleanTaxId(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, '');
  return d.length ? d : null;
}

function parseNfe(doc: Document): ParsedFiscalXml {
  const ide = findFirst(doc, ['ide']);
  const emit = findFirst(doc, ['emit']);
  const dest = findFirst(doc, ['dest']);
  const total = findFirst(doc, ['ICMSTot']);
  const infNFe = findFirst(doc, ['infNFe']);
  const cobr = findFirst(doc, ['cobr']);

  const chNFe = infNFe?.getAttribute('Id')?.replace(/^NFe/, '') || null;

  const dupls = cobr ? descendants(cobr, 'dup') : [];
  const installments = dupls.map(d => ({
    number: text(d, 'nDup'),
    due_date: normalizeDate(text(d, 'dVenc')),
    amount: toNumber(text(d, 'vDup')),
  }));

  const emitterName = text(emit, 'xNome') || text(emit, 'xFant');
  const destName = text(dest, 'xNome') || text(dest, 'xFant');

  return {
    kind: 'nfe',
    document_number: text(ide, 'nNF'),
    access_key: chNFe && chNFe.length === 44 ? chNFe : null,
    series: text(ide, 'serie'),
    issue_date: normalizeDate(text(ide, 'dhEmi') || text(ide, 'dEmi')),
    amount: toNumber(text(total, 'vNF')) ?? toNumber(text(total, 'vProd')),
    emitter: { name: emitterName, tax_id: cleanTaxId(text(emit, 'CNPJ') || text(emit, 'CPF')) },
    recipient: { name: destName, tax_id: cleanTaxId(text(dest, 'CNPJ') || text(dest, 'CPF')) },
    installments,
    first_due_date: installments.length ? installments[0].due_date : null,
    description: text(findFirst(doc, ['det']) as Element | null, 'xProd'),
  };
}

function parseNfse(doc: Document): ParsedFiscalXml {
  // Works for ABRASF-like layouts (Ginfes, Betha, DSF, Nota Carioca, etc.)
  const infNfse = findFirst(doc, ['InfNfse', 'infNfse']) as Element | null;
  const infRps  = findFirst(doc, ['Rps', 'InfDeclaracaoPrestacaoServico', 'InfRps']) as Element | null;
  const prestador = findFirst(doc, ['PrestadorServico', 'Prestador']) as Element | null;
  const tomador   = findFirst(doc, ['TomadorServico', 'Tomador']) as Element | null;
  const servico   = findFirst(doc, ['Servico']) as Element | null;
  const valores   = servico ? descendants(servico, 'Valores')[0] : undefined;

  const emitterName = text(prestador, 'RazaoSocial') || text(prestador, 'NomeFantasia');
  const recipientName = text(tomador, 'RazaoSocial') || text(tomador, 'NomeFantasia');
  const emitterCnpj = cleanTaxId(text(prestador, 'Cnpj') || text(prestador, 'CpfCnpj'));
  const recipientCnpj = cleanTaxId(text(tomador, 'Cnpj') || text(tomador, 'CpfCnpj'));

  const amount = toNumber(text(valores, 'ValorLiquidoNfse'))
              ?? toNumber(text(valores, 'ValorServicos'))
              ?? toNumber(text(valores, 'ValorTotal'));

  const numero = text(infNfse, 'Numero') || text(infRps, 'Numero');
  const serie  = text(infNfse, 'Serie')  || text(infRps, 'Serie');
  const emiDate = normalizeDate(
    text(infNfse, 'DataEmissao') || text(infRps, 'DataEmissao')
  );

  return {
    kind: 'nfse',
    document_number: numero,
    access_key: null,
    series: serie,
    issue_date: emiDate,
    amount,
    emitter: { name: emitterName, tax_id: emitterCnpj },
    recipient: { name: recipientName, tax_id: recipientCnpj },
    installments: [],
    first_due_date: null,
    description: text(servico, 'Discriminacao'),
  };
}

export async function parseFiscalXml(file: File): Promise<ParsedFiscalXml> {
  const raw = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, 'application/xml');
  const err = descendants(doc, 'parsererror')[0];
  if (err) throw new Error('XML inválido: ' + (err.textContent || 'não foi possível ler o arquivo'));

  if (descendants(doc, 'infNFe').length > 0) return parseNfe(doc);
  if (
    descendants(doc, 'InfNfse').length > 0 ||
    descendants(doc, 'infNfse').length > 0 ||
    descendants(doc, 'Rps').length > 0
  ) return parseNfse(doc);

  return {
    kind: 'unknown',
    document_number: null, access_key: null, series: null,
    issue_date: null, amount: null,
    emitter: { name: null, tax_id: null },
    recipient: { name: null, tax_id: null },
    installments: [], first_due_date: null, description: null,
  };
}
