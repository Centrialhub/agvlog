export interface NFSeBatchRetryDocument {
  rps_number?: string | null;
  invoice_number?: string | null;
  status?: string | null;
}

const DEFINITIVE_REJECTION_STATUSES = new Set([
  'rejected',
  'rejeitado',
  'rejeitada',
]);

export function assertNFSeBatchRetryable(documents: NFSeBatchRetryDocument[]): void {
  const rejected = documents.filter((document) =>
    DEFINITIVE_REJECTION_STATUSES.has(String(document.status || '').trim().toLowerCase()),
  );
  if (rejected.length === 0) return;

  const labels = rejected.map((document) =>
    document.rps_number
      ? `RPS ${document.rps_number}`
      : document.invoice_number
        ? `NF ${document.invoice_number}`
        : 'documento rejeitado',
  );
  throw new Error(
    `A tentativa anterior tem rejeição definitiva (${labels.join(', ')}). ` +
    'Ela não pode ser retransmitida com o mesmo RPS e o mesmo snapshot. ' +
    'Descarte esta tentativa e prepare uma nova emissão para aplicar o endereço corrigido.',
  );
}
