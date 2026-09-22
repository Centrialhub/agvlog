export const INGESTION_MAX_FILES = 500;
export const INGESTION_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const INGESTION_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const INGESTION_READ_CONCURRENCY = 2;
export const ORT_MAX_FILES = 5;
export const ORT_MAX_FILE_BYTES = 3 * 1024 * 1024;
export const ORT_MAX_BASE64_BYTES = 8 * 1024 * 1024;

export function ingestionSelectionError(files: readonly File[]): string | null {
  if (files.length > INGESTION_MAX_FILES) {
    return `Selecione no máximo ${INGESTION_MAX_FILES} arquivos por lote.`;
  }
  const oversized = files.find((file) => file.size > INGESTION_MAX_FILE_BYTES);
  if (oversized) {
    return `O arquivo "${oversized.name}" excede o limite de 10 MB.`;
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > INGESTION_MAX_TOTAL_BYTES) {
    return 'O lote excede o limite total de 50 MB.';
  }
  return null;
}

export function ortSelectionError(files: readonly File[]): string | null {
  if (files.length > ORT_MAX_FILES) return `Envie no máximo ${ORT_MAX_FILES} páginas por extração.`;
  const oversized = files.find((file) => file.size > ORT_MAX_FILE_BYTES);
  if (oversized) return `"${oversized.name}" excede o limite de 3 MB por arquivo.`;
  const estimatedBase64Bytes = files.reduce((total, file) => total + Math.ceil(file.size / 3) * 4, 0);
  if (estimatedBase64Bytes > ORT_MAX_BASE64_BYTES) {
    return 'O conjunto excede o limite de 8 MB após a conversão para envio.';
  }
  return null;
}
