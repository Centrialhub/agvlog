import { DOCCOB_LINE_LENGTHS, DoccobParsedFile, DoccobParsedInvoice } from './doccobTypes';

/**
 * Parser leve: identifica registros 000/350/351/352/353/354/355 e
 * extrai campos-chave (número da fatura, total do trailer).
 * Layout completo é preservado como raw para inspeção.
 */
export function parseDoccobFile(content: string): DoccobParsedFile {
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  const warnings: string[] = [];

  const result: DoccobParsedFile = {
    header: null,
    identification: null,
    carrier: null,
    invoices: [],
    trailer: null,
    validationWarnings: warnings,
  };

  let currentInvoice: DoccobParsedInvoice | null = null;
  let currentCharge: { raw: string; details: string[] } | null = null;

  for (const line of lines) {
    const type = line.slice(0, 3);
    if (!(type in DOCCOB_LINE_LENGTHS)) {
      warnings.push(`Tipo de registro desconhecido: "${type}"`);
      continue;
    }
    const expected = DOCCOB_LINE_LENGTHS[type as keyof typeof DOCCOB_LINE_LENGTHS];
    if (line.length !== expected) {
      warnings.push(`Registro ${type} com tamanho ${line.length}, esperado ${expected}`);
    }
    switch (type) {
      case '000':
        result.header = { raw: line, carrier: line.slice(3, 43).trim() };
        break;
      case '350':
        result.identification = { raw: line, kind: line.slice(3, 13).trim() };
        break;
      case '351':
        result.carrier = { raw: line, cnpj: line.slice(3, 17).trim(), name: line.slice(17, 77).trim() };
        break;
      case '352': {
        const invoiceNumber = line.slice(18, 38).trim();
        currentInvoice = { raw: line, invoiceNumber, totalCents: parseInt(line.slice(54, 69), 10) || 0, charges: [] };
        result.invoices.push(currentInvoice);
        currentCharge = null;
        break;
      }
      case '353': {
        if (!currentInvoice) {
          warnings.push('Registro 353 sem fatura ativa (352 esperado antes).');
          continue;
        }
        currentCharge = { raw: line, details: [] };
        currentInvoice.charges.push(currentCharge);
        break;
      }
      case '354': {
        if (!currentCharge) {
          warnings.push('Registro 354 sem cobrança ativa (353 esperado antes).');
          continue;
        }
        currentCharge.details.push(line);
        break;
      }
      case '355':
        result.trailer = {
          raw: line,
          invoiceCount: line.slice(3, 9).trim(),
          totalCents: line.slice(9, 24).trim(),
          recordCount: line.slice(24, 30).trim(),
        };
        break;
    }
  }

  return result;
}

export function trailerTotalReais(parsed: DoccobParsedFile): number {
  const cents = parseInt(parsed.trailer?.totalCents ?? '0', 10) || 0;
  return cents / 100;
}