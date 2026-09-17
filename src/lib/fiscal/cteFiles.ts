import { hubFiscal } from '@/lib/fiscal/hubFiscalClient';
import { fetchCachedFiscalBlob } from '@/lib/fiscal/fiscalFileValidation';

/** Referências mínimas necessárias para obter o arquivo de um CT-e. */
export interface CteFileRef {
  id: string;
  cte_number?: string | null;
  access_key?: string | null;
  hub_document_id?: string | null;
  emission_id?: string | null;
  pdf_url?: string | null;
  xml_url?: string | null;
  source?: 'draft' | 'hub' | string | null;
}

export function cteFileName(row: CteFileRef, format: 'pdf' | 'xml') {
  return `cte-${row.access_key || row.cte_number || row.id}.${format}`;
}

export function cteLabel(row: CteFileRef) {
  return `CT-e ${row.cte_number || row.access_key || row.id.slice(0, 8)}`;
}

export function canDownloadCte(row: CteFileRef) {
  return Boolean(row.hub_document_id || row.pdf_url || row.xml_url);
}

/** Usa primeiro o link já armazenado; o Hub Fiscal é a contingência. */
export async function fetchCteBlob(row: CteFileRef, format: 'pdf' | 'xml'): Promise<Blob> {
  const cachedUrl = format === 'pdf' ? row.pdf_url : row.xml_url;
  if (cachedUrl) {
    try {
      return await fetchCachedFiscalBlob(cachedUrl, format);
    } catch { /* link expirado/CORS: tenta o proxy autenticado */ }
  }
  if (row.hub_document_id) {
    return hubFiscal.file(row.hub_document_id, format, { type: 'cte', emissionId: row.emission_id ?? undefined });
  }
  throw new Error(
    row.source === 'hub'
      ? 'Sem id do Hub Fiscal — sincronize a emissão antes de baixar.'
      : 'Rascunho local nunca transmitido ao Hub Fiscal/SEFAZ.',
  );
}

export function saveBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

export function openBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const win = window.open(objectUrl, '_blank', 'noopener,noreferrer');
  if (!win) saveBlob(blob, filename);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
