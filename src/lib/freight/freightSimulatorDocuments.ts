export type FreightSimulatorDocumentIdentity = {
  id: string;
  access_key?: string | null;
  invoice_number?: string | null;
  remitter?: string | null;
  document_type?: string | null;
  created_at?: string | null;
  issue_date?: string | null;
};

function normalized(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase('pt-BR') ?? '';
}

export function freightDocumentIdentity(document: FreightSimulatorDocumentIdentity): string {
  const accessKey = normalized(document.access_key);
  if (accessKey) return `key:${accessKey}`;
  const invoiceNumber = normalized(document.invoice_number);
  const remitter = normalized(document.remitter);
  const documentType = normalized(document.document_type);
  if (invoiceNumber || remitter) return `fallback:${invoiceNumber}|${remitter}|${documentType}`;
  return `id:${document.id}`;
}

export function deduplicateFreightDocuments<T extends FreightSimulatorDocumentIdentity>(documents: T[]): T[] {
  const seen = new Map<string, T>();
  for (const document of documents) {
    const identity = freightDocumentIdentity(document);
    const existing = seen.get(identity);
    if (!existing) {
      seen.set(identity, document);
      continue;
    }
    const currentTime = new Date(document.created_at || document.issue_date || 0).getTime();
    const existingTime = new Date(existing.created_at || existing.issue_date || 0).getTime();
    if (currentTime > existingTime) seen.set(identity, document);
  }
  return Array.from(seen.values());
}
