// Client-side parsers for NF-e (mod 55) and CT-e (mod 57).
// Fully DOM-based (uses browser DOMParser). Tests can inject a parser via `parseXmlString`.

function firstEl(root: Element | Document | null, tag: string): Element | null {
  if (!root) return null;
  const list = root.getElementsByTagName(tag);
  return list.length ? list[0] : null;
}
function textOf(root: Element | Document | null, tag: string): string | null {
  const el = firstEl(root, tag);
  return el?.textContent?.trim() || null;
}
function num(v: string | null): number {
  if (!v) return 0;
  const n = parseFloat(v.replace(',', '.'));
  return isFinite(n) ? n : 0;
}
function isoDate(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export interface ParsedNfe {
  kind: 'nfe';
  access_key: string | null;
  number: string | null;
  series: string | null;
  issue_date: string | null;
  issuer_name: string | null;
  issuer_cnpj: string | null;
  recipient_name: string | null;
  recipient_cnpj: string | null;
  destination_city: string | null;
  destination_state: string | null;
  origin_city: string | null;
  origin_state: string | null;
  total_value: number;
  weight_kg: number;
  volume_count: number;
  info: string | null;
  reference: string | null;
}

export interface ParsedCte {
  kind: 'cte';
  access_key: string | null;
  number: string | null;
  series: string | null;
  issue_date: string | null;
  remitter_name: string | null;
  recipient_name: string | null;
  taker_name: string | null;
  freight_value: number;
  cargo_value: number;
  origin_city: string | null;
  origin_state: string | null;
  destination_city: string | null;
  destination_state: string | null;
  driver_name: string | null;
  vehicle_plate: string | null;
  referenced_nfe_keys: string[];
  info: string | null;
}

export type ParsedXmlDoc =
  | ParsedNfe
  | ParsedCte
  | { kind: 'unsupported'; reason: string };

function extractAccessKey(root: Element | Document): string | null {
  // NFe / CTe wrappers expose Id="NFe35..."
  for (const tag of ['infNFe', 'infCte']) {
    const el = firstEl(root, tag);
    const id = el?.getAttribute('Id');
    if (id) return id.replace(/^[A-Za-z]+/, '') || null;
  }
  return textOf(root, 'chNFe') || textOf(root, 'chCTe') || null;
}

function parseNfe(doc: Document): ParsedNfe {
  const emit = firstEl(doc, 'emit');
  const dest = firstEl(doc, 'dest');
  const enderEmit = firstEl(emit, 'enderEmit');
  const enderDest = firstEl(dest, 'enderDest');
  const total = firstEl(doc, 'ICMSTot');
  return {
    kind: 'nfe',
    access_key: extractAccessKey(doc),
    number: textOf(doc, 'nNF'),
    series: textOf(doc, 'serie'),
    issue_date: isoDate(textOf(doc, 'dhEmi') || textOf(doc, 'dEmi')),
    issuer_name: textOf(emit, 'xNome'),
    issuer_cnpj: textOf(emit, 'CNPJ'),
    recipient_name: textOf(dest, 'xNome'),
    recipient_cnpj: textOf(dest, 'CNPJ') || textOf(dest, 'CPF'),
    origin_city: textOf(enderEmit, 'xMun'),
    origin_state: textOf(enderEmit, 'UF'),
    destination_city: textOf(enderDest, 'xMun'),
    destination_state: textOf(enderDest, 'UF'),
    total_value: num(textOf(total, 'vNF')),
    weight_kg: num(textOf(doc, 'pesoB') || textOf(doc, 'pesoL')),
    volume_count: num(textOf(doc, 'qVol')),
    info: textOf(doc, 'infCpl'),
    reference: textOf(doc, 'xPed') || textOf(doc, 'refNFe'),
  };
}

function parseCte(doc: Document): ParsedCte {
  const rem = firstEl(doc, 'rem');
  const dest = firstEl(doc, 'dest');
  const toma = firstEl(doc, 'toma3') || firstEl(doc, 'toma4');
  const enderRem = firstEl(rem, 'enderReme');
  const enderDest = firstEl(dest, 'enderDest');
  const vPrest = firstEl(doc, 'vPrest');

  const refs: string[] = [];
  const infNfes = doc.getElementsByTagName('infNFe');
  for (let i = 0; i < infNfes.length; i++) {
    const c = infNfes[i].getElementsByTagName('chave')[0]?.textContent?.trim();
    if (c) refs.push(c);
  }
  const infDocs = doc.getElementsByTagName('infDoc');
  for (let i = 0; i < infDocs.length; i++) {
    const chs = infDocs[i].getElementsByTagName('chave');
    for (let j = 0; j < chs.length; j++) {
      const c = chs[j].textContent?.trim();
      if (c) refs.push(c);
    }
  }

  return {
    kind: 'cte',
    access_key: extractAccessKey(doc),
    number: textOf(doc, 'nCT'),
    series: textOf(doc, 'serie'),
    issue_date: isoDate(textOf(doc, 'dhEmi')),
    remitter_name: textOf(rem, 'xNome'),
    recipient_name: textOf(dest, 'xNome'),
    taker_name: textOf(toma, 'xNome'),
    freight_value: num(textOf(vPrest, 'vTPrest') || textOf(doc, 'vTPrest')),
    cargo_value: num(textOf(doc, 'vCarga')),
    origin_city: textOf(enderRem, 'xMun') || textOf(doc, 'xMunIni'),
    origin_state: textOf(enderRem, 'UF') || textOf(doc, 'UFIni'),
    destination_city: textOf(enderDest, 'xMun') || textOf(doc, 'xMunFim'),
    destination_state: textOf(enderDest, 'UF') || textOf(doc, 'UFFim'),
    driver_name: textOf(doc, 'xNome'),
    vehicle_plate: textOf(doc, 'placa'),
    referenced_nfe_keys: Array.from(new Set(refs)),
    info: textOf(doc, 'xObs') || textOf(doc, 'infCpl'),
  };
}

function parseXmlString(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

export function parseFiscalXml(xml: string): ParsedXmlDoc {
  const doc = parseXmlString(xml);
  if (doc.getElementsByTagName('parsererror').length) {
    return { kind: 'unsupported', reason: 'XML malformado' };
  }
  if (doc.getElementsByTagName('infCte').length || doc.getElementsByTagName('CTe').length) {
    return parseCte(doc);
  }
  if (doc.getElementsByTagName('infNFe').length || doc.getElementsByTagName('NFe').length) {
    return parseNfe(doc);
  }
  return { kind: 'unsupported', reason: 'XML fora do escopo (não é NF-e mod 55 nem CT-e mod 57)' };
}

/** Try to match a CT-e's referenced NFe keys against previously parsed NFes and return match info. */
export function matchCteToNfes(cte: ParsedCte, nfes: ParsedNfe[]): { matched: ParsedNfe[]; unmatchedKeys: string[] } {
  const byKey = new Map<string, ParsedNfe>();
  for (const n of nfes) if (n.access_key) byKey.set(n.access_key, n);
  const matched: ParsedNfe[] = [];
  const unmatchedKeys: string[] = [];
  for (const k of cte.referenced_nfe_keys) {
    const n = byKey.get(k);
    if (n) matched.push(n); else unmatchedKeys.push(k);
  }
  return { matched, unmatchedKeys };
}