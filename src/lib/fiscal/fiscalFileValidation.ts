import {
  FISCAL_FILE_HEADER_BYTES,
  isFiscalFileHeaderValid,
  type FiscalFileFormat,
} from '../../../supabase/functions/_shared/fiscal-file-validation';

export type { FiscalFileFormat };

async function readBlobHeader(blob: Blob): Promise<Uint8Array> {
  const part = blob.slice(0, FISCAL_FILE_HEADER_BYTES);
  const arrayBuffer = (part as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  if (typeof arrayBuffer === 'function') {
    return new Uint8Array(await arrayBuffer.call(part));
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler o arquivo fiscal.'));
    reader.readAsArrayBuffer(part);
  });
}

export async function validateFiscalBlob(blob: Blob, format: FiscalFileFormat): Promise<void> {
  if (!blob || blob.size === 0) throw new Error('Arquivo vazio retornado pelo Hub Fiscal.');

  const bytes = await readBlobHeader(blob);
  if (!isFiscalFileHeaderValid(bytes, format)) {
    throw new Error(`O provedor não retornou um ${format === 'pdf' ? 'PDF' : 'XML'} válido.`);
  }
}

export async function fetchCachedFiscalBlob(
  url: string,
  format: FiscalFileFormat,
  timeoutMs = 12_000,
): Promise<Blob> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Arquivo em cache indisponível (${response.status}).`);
    const blob = await response.blob();
    await validateFiscalBlob(blob, format);
    return blob;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Tempo esgotado ao acessar o arquivo em cache.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
