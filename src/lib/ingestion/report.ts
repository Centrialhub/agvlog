import type { ValidatedDocument } from '@/lib/ingestionValidator';
import type { IngestionReport, OrtReviewDocument, ReviewItem } from '@/lib/ingestion/types';

type ReportSource = ValidatedDocument['source'] & {
  confidence?: number | null;
};

export interface BuildIngestionReportArgs {
  docs: ValidatedDocument[];
  ortReviewDocs: OrtReviewDocument[];
  savedCount: number;
  errorCount: number;
  autoCreatedCount: number;
  matchedCount: number;
  reviewThreshold: number;
  sourceLabel?: string;
  tenant?: {
    id?: string | null;
    name?: string | null;
  } | null;
  generatedByUserId?: string | null;
  generatedAt?: Date;
}

function onlyDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim();
  return normalized.length > 0 && !/^(UNKNOWN|N\/?I|N\/?A)$/i.test(normalized);
}

export function createIngestionBatchId(generatedAt = new Date()): string {
  return `ING-${generatedAt.toISOString().replace(/\D/g, '').slice(0, 14)}`;
}

export function buildIngestionReport(args: BuildIngestionReportArgs): IngestionReport {
  const {
    docs,
    ortReviewDocs,
    savedCount,
    errorCount,
    autoCreatedCount,
    matchedCount,
    reviewThreshold,
    sourceLabel,
    tenant,
    generatedByUserId,
    generatedAt = new Date(),
  } = args;
  const total = docs.length;
  const count = (predicate: (source: ReportSource) => boolean) =>
    docs.filter((doc) => predicate(doc.source)).length;

  const fieldCoverage = [
    { key: 'cnpj', label: 'CNPJ/CPF do destinatário', filled: count((source) => isFilled(source.recipientCnpj)), total },
    { key: 'ie', label: 'Inscrição Estadual (IE)', filled: count((source) => isFilled(source.recipientStateRegistration)), total },
    { key: 'im', label: 'Inscrição Municipal (IM)', filled: count((source) => isFilled(source.recipientMunicipalRegistration)), total },
    { key: 'email', label: 'E-mail', filled: count((source) => isFilled(source.recipientEmail)), total },
    { key: 'phone', label: 'Telefone', filled: count((source) => isFilled(source.recipientPhone)), total },
    {
      key: 'address',
      label: 'Endereço completo (rua/cidade/UF/CEP)',
      filled: count((source) =>
        isFilled(source.recipientAddress)
        && isFilled(source.recipientCity)
        && isFilled(source.recipientState)
        && isFilled(source.recipientZip)),
      total,
    },
    {
      key: 'ibge',
      label: 'Código IBGE do município',
      filled: count((source) => onlyDigits(source.recipientCityCode).length === 7),
      total,
    },
  ];

  const needsReviewDocs =
    ortReviewDocs.filter((doc) => doc.needsReview).length
    + docs.filter((doc) => Number((doc.source as ReportSource).confidence ?? 1) < reviewThreshold).length;
  const unresolved = docs.filter((doc) => !doc.matchedClientId).length;

  const issueDates = docs
    .map((doc) => doc.source.issueDate)
    .filter(Boolean)
    .map((issueDate) => new Date(issueDate))
    .filter((issueDate) => !Number.isNaN(issueDate.getTime()));
  const periodFrom = issueDates.length
    ? new Date(Math.min(...issueDates.map((issueDate) => issueDate.getTime())))
    : null;
  const periodTo = issueDates.length
    ? new Date(Math.max(...issueDates.map((issueDate) => issueDate.getTime())))
    : null;

  const reviewItems: ReviewItem[] = [];
  const seenInvoices = new Set<string>();

  for (const ort of ortReviewDocs) {
    const reasons: string[] = [];
    if (ort.confidence < reviewThreshold) {
      reasons.push(`Baixa confiança OCR (${Math.round((ort.confidence || 0) * 100)}%)`);
    }
    if (ort.unknownFields && ort.unknownFields.length > 0) {
      const sample = ort.unknownFields.slice(0, 4).join(', ');
      const more = ort.unknownFields.length > 4 ? ` (+${ort.unknownFields.length - 4})` : '';
      reasons.push(`Campos não mapeados: ${sample}${more}`);
    }
    if (ort.needsReview && reasons.length === 0) {
      reasons.push('Marcado para revisão manual');
    }
    if (reasons.length === 0) continue;
    seenInvoices.add(ort.invoiceNumber);
    reviewItems.push({
      invoiceNumber: ort.invoiceNumber,
      fileName: ort.fileName,
      recipientName: ort.recipientName,
      confidence: ort.confidence,
      reasons,
    });
  }

  for (const doc of docs) {
    const source = doc.source as ReportSource;
    const confidence = Number(source.confidence ?? 1);
    const reasons: string[] = [];
    if (confidence < reviewThreshold) {
      reasons.push(`Baixa confiança (${Math.round(confidence * 100)}%)`);
    }

    const missing: string[] = [];
    if (!isFilled(source.recipientCnpj)) missing.push('CNPJ');
    if (!isFilled(source.recipientStateRegistration)) missing.push('IE');
    if (!isFilled(source.recipientAddress) || !isFilled(source.recipientCity) || !isFilled(source.recipientZip)) {
      missing.push('endereço');
    }
    if (!doc.matchedClientId) missing.push('cliente');
    if (missing.length > 0 && confidence < reviewThreshold) {
      reasons.push(`Mapeamento incompleto: ${missing.join(', ')}`);
    }
    if (reasons.length === 0 || seenInvoices.has(source.invoiceNumber)) continue;

    reviewItems.push({
      invoiceNumber: source.invoiceNumber,
      recipientName: source.recipientName,
      confidence,
      reasons,
    });
  }

  return {
    totalDocs: total,
    savedDocs: savedCount,
    errorDocs: errorCount,
    needsReviewDocs,
    clientsAutoCreated: autoCreatedCount,
    clientsMatched: matchedCount,
    clientsUnresolved: Math.max(0, unresolved - autoCreatedCount),
    fieldCoverage,
    reviewItems,
    reviewThreshold,
    auditMeta: {
      tenantId: tenant?.id || null,
      tenantName: tenant?.name || null,
      batchId: createIngestionBatchId(generatedAt),
      sourceLabel: sourceLabel || null,
      generatedAt: generatedAt.toISOString(),
      periodFrom: periodFrom ? periodFrom.toISOString() : null,
      periodTo: periodTo ? periodTo.toISOString() : null,
      generatedByUserId: generatedByUserId || null,
    },
  };
}
