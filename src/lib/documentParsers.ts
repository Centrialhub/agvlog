// NF-e XML parser — extracts structured data from Brazilian electronic invoice XML

export interface ParsedNFeItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  ncm: string;
  cfop: string;
}

export interface ParsedNFe {
  invoiceNumber: string;
  series: string;
  accessKey: string;
  issueDate: string;
  emitterName: string;
  emitterCnpj: string;
  recipientName: string;
  recipientCnpj: string;
  recipientCity: string;
  recipientState: string;
  recipientAddress: string;
  items: ParsedNFeItem[];
  totalValue: number;
  totalWeight: number;
  totalVolume: number;
  estimatedPallets: number;
}

function getTagText(parent: Element, tagName: string): string {
  // NF-e uses namespaced XML, try both with and without namespace
  const el = parent.getElementsByTagName(tagName)[0]
    || parent.getElementsByTagName(`nfe:${tagName}`)[0];
  return el?.textContent?.trim() || '';
}

function getNestedText(parent: Element, ...tags: string[]): string {
  let current: Element | null = parent;
  for (const tag of tags) {
    if (!current) return '';
    current = current.getElementsByTagName(tag)[0]
      || current.getElementsByTagName(`nfe:${tag}`)[0]
      || null;
  }
  return current?.textContent?.trim() || '';
}

export function parseNFeXml(xmlString: string): ParsedNFe {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');

  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('XML inválido: ' + parseError.textContent);
  }

  // Find the infNFe element (main NF-e data container)
  const infNFe = doc.getElementsByTagName('infNFe')[0]
    || doc.getElementsByTagName('nfe:infNFe')[0];

  if (!infNFe) {
    throw new Error('Estrutura de NF-e não encontrada no XML');
  }

  // Access key from Id attribute
  const accessKey = (infNFe.getAttribute('Id') || '').replace(/^NFe/, '');

  // ide - identification
  const ide = infNFe.getElementsByTagName('ide')[0];
  const invoiceNumber = getTagText(ide || infNFe, 'nNF');
  const series = getTagText(ide || infNFe, 'serie');
  const issueDate = getTagText(ide || infNFe, 'dhEmi').substring(0, 10);

  // emit - emitter
  const emit = infNFe.getElementsByTagName('emit')[0];
  const emitterName = getTagText(emit || infNFe, 'xNome');
  const emitterCnpj = getTagText(emit || infNFe, 'CNPJ');

  // dest - recipient
  const dest = infNFe.getElementsByTagName('dest')[0];
  const recipientName = getTagText(dest || infNFe, 'xNome');
  const recipientCnpj = getTagText(dest || infNFe, 'CNPJ') || getTagText(dest || infNFe, 'CPF');
  
  const enderDest = dest?.getElementsByTagName('enderDest')[0];
  const recipientCity = getTagText(enderDest || infNFe, 'xMun');
  const recipientState = getTagText(enderDest || infNFe, 'UF');
  const recipientAddress = [
    getTagText(enderDest || infNFe, 'xLgr'),
    getTagText(enderDest || infNFe, 'nro'),
    getTagText(enderDest || infNFe, 'xBairro'),
  ].filter(Boolean).join(', ');

  // det - items
  const detElements = infNFe.getElementsByTagName('det');
  const items: ParsedNFeItem[] = [];
  
  for (let i = 0; i < detElements.length; i++) {
    const det = detElements[i];
    const prod = det.getElementsByTagName('prod')[0];
    if (!prod) continue;

    items.push({
      description: getTagText(prod, 'xProd'),
      quantity: parseFloat(getTagText(prod, 'qCom')) || 0,
      unit: getTagText(prod, 'uCom'),
      unitPrice: parseFloat(getTagText(prod, 'vUnCom')) || 0,
      totalPrice: parseFloat(getTagText(prod, 'vProd')) || 0,
      ncm: getTagText(prod, 'NCM'),
      cfop: getTagText(prod, 'CFOP'),
    });
  }

  // totals
  const total = infNFe.getElementsByTagName('ICMSTot')[0];
  const totalValue = parseFloat(getTagText(total || infNFe, 'vNF')) || 0;

  // transport volumes
  const transp = infNFe.getElementsByTagName('transp')[0];
  const vol = transp?.getElementsByTagName('vol')[0];
  const totalWeight = parseFloat(getTagText(vol || infNFe, 'pesoB')) || 
                      parseFloat(getTagText(vol || infNFe, 'pesoL')) || 0;
  const totalVolume = 0; // Not standard in NF-e

  // Estimate pallets: ~800kg per pallet or ~1 pallet per 20 items as rough estimate
  const estimatedPallets = Math.max(1, Math.ceil(totalWeight / 800));

  return {
    invoiceNumber,
    series,
    accessKey,
    issueDate,
    emitterName,
    emitterCnpj,
    recipientName,
    recipientCnpj,
    recipientCity,
    recipientState,
    recipientAddress,
    items,
    totalValue,
    totalWeight,
    totalVolume,
    estimatedPallets,
  };
}

// CSV/Excel parser for orders
export interface ParsedOrderRow {
  orderNumber: string;
  clientName: string;
  clientCnpj: string;
  destination: string;
  items: string;
  quantity: number;
  palletCount: number;
  weightKg: number;
  promisedDate: string;
}

export function parseCsvOrders(csvText: string): ParsedOrderRow[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(/[,;\t]/).map(h => h.trim().toLowerCase().replace(/["\s]/g, ''));
  const rows: ParsedOrderRow[] = [];

  // Map common header names
  const findCol = (candidates: string[]) => {
    for (const c of candidates) {
      const idx = headers.findIndex(h => h.includes(c));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const colOrder = findCol(['pedido', 'order', 'numero', 'numpedido']);
  const colClient = findCol(['cliente', 'client', 'razao', 'empresa', 'nome']);
  const colCnpj = findCol(['cnpj', 'cpf', 'documento', 'taxid']);
  const colDest = findCol(['destino', 'destination', 'cidade', 'endereco', 'city']);
  const colItems = findCol(['item', 'produto', 'product', 'descricao', 'mercadoria']);
  const colQty = findCol(['quantidade', 'qty', 'qtd', 'quantity']);
  const colPallets = findCol(['palet', 'pallet', 'paletes']);
  const colWeight = findCol(['peso', 'weight', 'kg']);
  const colDate = findCol(['data', 'date', 'prazo', 'entrega', 'promised']);

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(/[,;\t]/).map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2 || cols.every(c => !c)) continue;

    rows.push({
      orderNumber: colOrder >= 0 ? cols[colOrder] || '' : `IMP-${i}`,
      clientName: colClient >= 0 ? cols[colClient] || '' : '',
      clientCnpj: colCnpj >= 0 ? cols[colCnpj] || '' : '',
      destination: colDest >= 0 ? cols[colDest] || '' : '',
      items: colItems >= 0 ? cols[colItems] || '' : '',
      quantity: colQty >= 0 ? parseFloat(cols[colQty]) || 0 : 0,
      palletCount: colPallets >= 0 ? parseInt(cols[colPallets]) || 0 : 0,
      weightKg: colWeight >= 0 ? parseFloat(cols[colWeight]) || 0 : 0,
      promisedDate: colDate >= 0 ? cols[colDate] || '' : '',
    });
  }

  return rows;
}
