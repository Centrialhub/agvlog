import {
  buildFixedLine,
  dateToDDMMYYYY,
  dateToHHMM,
  moneyToCents,
  normalizeAsciiUpper,
  padText,
  validateLineLength,
} from './fixedWidth';
import {
  DOCCOB_LINE_LENGTHS,
  DoccobBuildInput,
  DoccobBuildResult,
  DoccobChargeInput,
  DoccobDetailInput,
  DoccobInvoiceInput,
} from './doccobTypes';

const CRLF = '\r\n';

function simpleHash(input: string): string {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(13, '0');
}

export function generateRecord000(input: DoccobBuildInput, generatedAt: Date): string {
  const line = buildFixedLine([
    { kind: 'raw', value: '000', length: 3 },
    { kind: 'text', value: input.carrier.name, length: 40 },
    { kind: 'text', value: input.profile.destinationName ?? input.carrier.name, length: 40 },
    { kind: 'raw', value: dateToDDMMYYYY(generatedAt), length: 8 },
    { kind: 'raw', value: dateToHHMM(generatedAt), length: 4 },
    { kind: 'text', value: 'COB', length: 5 },
    { kind: 'text', value: input.profile.layoutVersion ?? 'SIAT_CTMS_DOCCOB', length: 20 },
  ]);
  return line.padEnd(DOCCOB_LINE_LENGTHS['000'], ' ').slice(0, DOCCOB_LINE_LENGTHS['000']);
}

export function generateRecord350(input: DoccobBuildInput, generatedAt: Date, sequence = 1): string {
  const line = buildFixedLine([
    { kind: 'raw', value: '350', length: 3 },
    { kind: 'text', value: 'COBRA', length: 10 },
    { kind: 'raw', value: dateToDDMMYYYY(generatedAt), length: 8 },
    { kind: 'raw', value: dateToHHMM(generatedAt), length: 4 },
    { kind: 'number', value: sequence, length: 6 },
  ]);
  return line.padEnd(DOCCOB_LINE_LENGTHS['350'], ' ').slice(0, DOCCOB_LINE_LENGTHS['350']);
}

export function generateRecord351(input: DoccobBuildInput): string {
  const line = buildFixedLine([
    { kind: 'raw', value: '351', length: 3 },
    { kind: 'number', value: input.carrier.cnpj, length: 14 },
    { kind: 'text', value: input.carrier.name, length: 60 },
    { kind: 'text', value: input.profile.companyCode ?? input.carrier.companyCode ?? '', length: 5 },
    { kind: 'text', value: input.profile.branchCode ?? input.carrier.branchCode ?? '', length: 5 },
  ]);
  return line.padEnd(DOCCOB_LINE_LENGTHS['351'], ' ').slice(0, DOCCOB_LINE_LENGTHS['351']);
}

export function generateRecord352(input: DoccobBuildInput, invoice: DoccobInvoiceInput): string {
  const line = buildFixedLine([
    { kind: 'raw', value: '352', length: 3 },
    { kind: 'text', value: input.profile.companyCode ?? 'AGV', length: 5 },
    { kind: 'text', value: input.profile.branchCode ?? 'MOC', length: 5 },
    { kind: 'text', value: input.profile.documentType ?? 'FAT', length: 5 },
    { kind: 'text', value: invoice.invoiceNumber, length: 20 },
    { kind: 'date', value: invoice.issueDate },
    { kind: 'date', value: invoice.dueDate },
    { kind: 'money', value: invoice.totalAmount, length: 15 },
    { kind: 'text', value: invoice.paymentMethod ?? '', length: 10 },
    { kind: 'text', value: input.profile.bankName ?? '', length: 20 },
    { kind: 'text', value: input.profile.bankAgency ?? '', length: 10 },
    { kind: 'text', value: input.profile.bankAccount ?? '', length: 15 },
    { kind: 'text', value: invoice.clientName, length: 40 },
    { kind: 'number', value: invoice.clientTaxId ?? '', length: 14 },
  ]);
  return line.padEnd(DOCCOB_LINE_LENGTHS['352'], ' ').slice(0, DOCCOB_LINE_LENGTHS['352']);
}

export function generateRecord353(charge: DoccobChargeInput, invoice: DoccobInvoiceInput): string {
  const line = buildFixedLine([
    { kind: 'raw', value: '353', length: 3 },
    { kind: 'text', value: charge.sourceType, length: 15 },
    { kind: 'text', value: charge.sourceNumber ?? '', length: 20 },
    { kind: 'text', value: charge.sourceSeries ?? '', length: 5 },
    { kind: 'text', value: charge.referenceNumber ?? '', length: 20 },
    { kind: 'date', value: charge.issueDate ?? invoice.issueDate },
    { kind: 'money', value: charge.grossAmount, length: 15 },
    { kind: 'number', value: charge.carrierCnpj ?? '', length: 14 },
    { kind: 'text', value: invoice.invoiceNumber, length: 20 },
    { kind: 'text', value: (charge.description ?? '').slice(0, 50), length: 50 },
  ]);
  return line.padEnd(DOCCOB_LINE_LENGTHS['353'], ' ').slice(0, DOCCOB_LINE_LENGTHS['353']);
}

export function generateRecord354(detail: DoccobDetailInput, charge: DoccobChargeInput): string {
  const line = buildFixedLine([
    { kind: 'raw', value: '354', length: 3 },
    { kind: 'text', value: detail.documentNumber ?? '', length: 20 },
    { kind: 'date', value: detail.emissionDate ?? charge.issueDate ?? null },
    { kind: 'money', value: detail.cargoValue ?? 0, length: 15 },
    { kind: 'money', value: Math.round((detail.weightKg ?? 0) * 1000) / 1000, length: 12 },
    { kind: 'text', value: charge.sourceNumber ?? '', length: 20 },
  ]);
  return line.padEnd(DOCCOB_LINE_LENGTHS['354'], ' ').slice(0, DOCCOB_LINE_LENGTHS['354']);
}

export function generateRecord355(invoiceCount: number, totalAmount: number, recordCount: number): string {
  const line = buildFixedLine([
    { kind: 'raw', value: '355', length: 3 },
    { kind: 'number', value: invoiceCount, length: 6 },
    { kind: 'money', value: totalAmount, length: 15 },
    { kind: 'number', value: recordCount, length: 6 },
  ]);
  return line.padEnd(DOCCOB_LINE_LENGTHS['355'], ' ').slice(0, DOCCOB_LINE_LENGTHS['355']);
}

export function generateDoccob(input: DoccobBuildInput): DoccobBuildResult {
  const generatedAt = input.generatedAt ?? new Date();
  const lines: string[] = [];
  const warnings: string[] = [];
  const allowNoDetails = input.profile.allowChargeWithoutDetails === true;

  const push = (type: keyof typeof DOCCOB_LINE_LENGTHS, line: string) => {
    const w = validateLineLength(type, line, DOCCOB_LINE_LENGTHS[type]);
    if (w) warnings.push(w);
    lines.push(line);
  };

  push('000', generateRecord000(input, generatedAt));
  push('350', generateRecord350(input, generatedAt));
  push('351', generateRecord351(input));

  let chargeCount = 0;
  let detailCount = 0;
  let totalAmount = 0;

  for (const invoice of input.invoices) {
    push('352', generateRecord352(input, invoice));
    totalAmount += Number(invoice.totalAmount) || 0;
    for (const charge of invoice.charges) {
      push('353', generateRecord353(charge, invoice));
      chargeCount++;
      if (!charge.details || charge.details.length === 0) {
        if (!allowNoDetails) {
          throw new Error(
            `Cobrança ${charge.sourceNumber ?? charge.id} da fatura ${invoice.invoiceNumber} não possui notas fiscais vinculadas.`,
          );
        }
      } else {
        for (const detail of charge.details) {
          push('354', generateRecord354(detail, charge));
          detailCount++;
        }
      }
    }
  }

  push('355', generateRecord355(input.invoices.length, totalAmount, lines.length + 1));

  const content = lines.join(CRLF) + CRLF;
  return {
    content,
    recordCount: lines.length,
    invoiceCount: input.invoices.length,
    chargeCount,
    detailCount,
    totalAmount: Math.round(totalAmount * 100) / 100,
    hash: simpleHash(content),
    lengthWarnings: warnings,
  };
}

export { normalizeAsciiUpper, moneyToCents, padText };