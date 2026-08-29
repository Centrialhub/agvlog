import type { OrtReviewDocument } from '@/lib/ingestion/types';

export interface ExistingFiscalDocumentIdentity {
  access_key?: string | null;
  invoice_number?: string | null;
  remitter_cnpj?: string | null;
  recipient_cnpj?: string | null;
  reference_number?: string | null;
}

type OrtAccessKeySource = Pick<
  OrtReviewDocument,
  'invoiceNumber' | 'recipientCnpj' | 'recipientName' | 'recipientCity' | 'issueDate' | 'totalValue'
>;

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Erro ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

export function normalizeOrtKeyPart(value: unknown): string {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 48);
}

export function buildOrtAccessKey(ort: OrtAccessKeySource, fallback: string): string {
  const recipient = normalizeOrtKeyPart(ort.recipientCnpj) || normalizeOrtKeyPart(ort.recipientName);
  const city = normalizeOrtKeyPart(ort.recipientCity);
  const value = Math.round((Number(ort.totalValue) || 0) * 100);
  const parts = [
    normalizeOrtKeyPart(ort.invoiceNumber) || fallback,
    recipient,
    city,
    normalizeOrtKeyPart(ort.issueDate),
    value || '0',
  ].filter(Boolean);

  return `ORT-${parts.join('-')}`;
}

export function toOrtAuditPayload(ort: OrtReviewDocument): Record<string, unknown> {
  return {
    documentKind: ort.documentKind,
    accessKey: ort.accessKey || '',
    invoiceNumber: ort.invoiceNumber,
    issueDate: ort.issueDate,
    paymentTerms: ort.paymentTerms,
    billing: ort.billing,
    cargoDescription: ort.cargoDescription,
    emitterName: ort.emitterName,
    emitterCnpj: ort.emitterCnpj,
    recipientName: ort.recipientName,
    recipientCnpj: ort.recipientCnpj,
    recipientPhone: ort.recipientPhone,
    recipientCity: ort.recipientCity,
    recipientState: ort.recipientState,
    recipientAddress: ort.recipientAddress,
    recipientAddressNumber: ort.recipientAddressNumber,
    recipientZip: ort.recipientZip,
    recipientNeighborhood: ort.recipientNeighborhood,
    totalValue: ort.totalValue,
    totalWeight: ort.totalWeight,
    totalVolume: ort.totalVolume,
    estimatedPallets: ort.estimatedPallets,
    productSummary: ort.productSummary,
    items: ort.items || [],
    pageCount: ort.pageCount || 1,
    sourcePages: ort.sourcePages || [ort.fileName],
  };
}

export function mapOrtItems(ort: OrtReviewDocument) {
  const extractedItems = (ort.items || [])
    .filter((item) => item.description?.trim())
    .map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity) || 0,
      unit: item.unit || '',
      unitPrice: Number(item.unitPrice) || Number(item.totalPrice) || 0,
      totalPrice: Number(item.totalPrice) || Number(item.unitPrice) || 0,
      ncm: '',
      cfop: '',
    }));

  return extractedItems;
}

export function getChangedOrtFields(ort: OrtReviewDocument): string[] {
  const extracted = ort.extractedPayload || {};
  const reviewed = toOrtAuditPayload(ort);

  return Object.keys(reviewed).filter(
    (key) => String(extracted[key] ?? '') !== String(reviewed[key] ?? ''),
  );
}

function unifiedOrtKey(doc: OrtReviewDocument, fallbackIndex: number): string {
  if (doc.documentKind === 'nfe' && doc.accessKey) {
    return `NFE#${String(doc.accessKey).replace(/\D/g, '')}`;
  }
  const ortNumber = normalizeOrtKeyPart(doc.invoiceNumber);
  const emitter = normalizeOrtKeyPart(doc.emitterCnpj) || normalizeOrtKeyPart(doc.emitterName);
  const recipient = normalizeOrtKeyPart(doc.recipientCnpj) || normalizeOrtKeyPart(doc.recipientName);
  if (ortNumber && (emitter || recipient)) return `ORT#${ortNumber}#${emitter}#${recipient}`;

  const cnpj = normalizeOrtKeyPart(doc.recipientCnpj);
  const address = normalizeOrtKeyPart(`${doc.recipientAddress}${doc.recipientAddressNumber}`);
  const city = normalizeOrtKeyPart(doc.recipientCity);
  const name = normalizeOrtKeyPart(doc.recipientName);
  if (cnpj && (address || city)) return `CNPJ#${cnpj}#${city}#${address}`;
  if (cnpj) return `CNPJ#${cnpj}`;
  if (name && address && city) return `NAME#${name}#${city}#${address}`;
  return `RAW#${doc.fileName}#${fallbackIndex}`;
}

export function dedupeOrtReviewDocs(
  docs: OrtReviewDocument[],
  existingDocs: readonly ExistingFiscalDocumentIdentity[],
) {
  const existingAccessKeys = new Set(existingDocs.map((doc) => doc.access_key).filter(Boolean));
  const existingReferences = new Set(existingDocs.map((doc) => doc.reference_number).filter(Boolean));
  const merged = new Map<string, OrtReviewDocument>();
  let mergedScans = 0;

  docs.forEach((doc, docIndex) => {
    const key = unifiedOrtKey(doc, docIndex);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...doc, unifiedDocId: key, mergedFrom: 1 });
      return;
    }

    mergedScans += 1;
    type Item = NonNullable<OrtReviewDocument['items']>[number];
    const itemMap = new Map<string, Item>();
    const pushItem = (item: Item) => {
      const itemKey = [
        (item.description || '').trim().toLowerCase(),
        Number(item.quantity) || 0,
        (item.unit || '').trim().toUpperCase(),
        Number(item.unitPrice) || 0,
        Number(item.totalPrice) || 0,
      ].join('|');
      if (!itemKey) return;
      if (!itemMap.has(itemKey)) {
        itemMap.set(itemKey, { ...item });
      }
    };
    (existing.items || []).forEach(pushItem);
    (doc.items || []).forEach(pushItem);

    const pages = Array.from(new Set([...(existing.sourcePages || []), ...(doc.sourcePages || [])]));
    merged.set(key, {
      ...existing,
      invoiceNumber: existing.invoiceNumber || doc.invoiceNumber,
      issueDate: existing.issueDate || doc.issueDate,
      paymentTerms: existing.paymentTerms || doc.paymentTerms,
      billing: existing.billing || doc.billing,
      cargoDescription: existing.cargoDescription || doc.cargoDescription,
      recipientPhone: existing.recipientPhone || doc.recipientPhone,
      recipientAddress: existing.recipientAddress || doc.recipientAddress,
      recipientAddressNumber: existing.recipientAddressNumber || doc.recipientAddressNumber,
      recipientZip: existing.recipientZip || doc.recipientZip,
      recipientNeighborhood: existing.recipientNeighborhood || doc.recipientNeighborhood,
      totalValue: Math.max(existing.totalValue || 0, doc.totalValue || 0),
      totalWeight: Math.max(existing.totalWeight || 0, doc.totalWeight || 0),
      totalVolume: Math.max(existing.totalVolume || 0, doc.totalVolume || 0),
      estimatedPallets: Math.max(existing.estimatedPallets || 0, doc.estimatedPallets || 0),
      items: Array.from(itemMap.values()),
      sourcePages: pages,
      pageCount: pages.length || (existing.pageCount || 1) + (doc.pageCount || 1),
      confidence: Math.min(existing.confidence || 0, doc.confidence || 0),
      needsReview: existing.needsReview || doc.needsReview,
      mergedFrom: (existing.mergedFrom || 1) + 1,
    });
  });

  let existingDuplicates = 0;
  const uniqueDocs: OrtReviewDocument[] = [];
  Array.from(merged.values()).forEach((doc, index) => {
    const key = doc.documentKind === 'nfe'
      ? String(doc.accessKey || '').replace(/\D/g, '')
      : buildOrtAccessKey(doc, `DOC${index + 1}`);
    const legacyKey = `ORT-${doc.invoiceNumber || index + 1}`;
    const alreadyExists =
      existingAccessKeys.has(key) ||
      existingAccessKeys.has(legacyKey) ||
      existingReferences.has(key);

    if (alreadyExists) {
      existingDuplicates += 1;
      return;
    }

    uniqueDocs.push({ ...doc, extractedPayload: toOrtAuditPayload(doc) });
  });

  return { uniqueDocs, batchDuplicates: mergedScans, existingDuplicates };
}
