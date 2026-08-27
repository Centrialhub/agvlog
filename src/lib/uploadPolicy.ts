/**
 * Política de upload alinhada aos buckets privados de produção.
 * Valida tamanho, tipo MIME (com fallback por extensão) e normaliza nomes de arquivo.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadKind = 'image' | 'proof' | 'financial';

const IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

const PROOF_TYPES = [...IMAGE_TYPES, 'application/pdf'] as const;

const FINANCIAL_TYPES = [...PROOF_TYPES, 'application/xml', 'text/xml'] as const;

export const ALLOWED_TYPES: Record<UploadKind, readonly string[]> = {
  image: IMAGE_TYPES,
  proof: PROOF_TYPES,
  financial: FINANCIAL_TYPES,
};

const EXTENSION_TYPES: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  xml: 'application/xml',
};

export function inferContentType(file: { name: string; type?: string }): string | null {
  const declared = (file.type || '').trim().toLowerCase();
  if (declared) return declared;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return EXTENSION_TYPES[ext] ?? null;
}

/**
 * Normaliza o nome do arquivo para uso seguro em caminhos de Storage.
 */
export function storageSafeFileName(rawName: string): string {
  const base = (rawName || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/]+/g, '_');

  let safe = base
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/_{2,}/g, '_')
    .replace(/^[._-]+/, '');

  safe = safe.slice(0, 120).replace(/[._-]+$/, '');

  if (!safe || !/[a-zA-Z0-9]/.test(safe)) return 'arquivo';
  return safe;
}

export interface ValidatedUpload {
  contentType: string;
  safeName: string;
}

/**
 * Valida um arquivo antes do upload. Lança Error com mensagem clara quando inválido.
 */
export function validateUpload(file: File, kind: UploadKind): ValidatedUpload {
  if (!file || file.size === 0) {
    throw new Error('Arquivo vazio ou inválido. Selecione outro arquivo.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Arquivo maior que o limite de 10 MB.');
  }

  const contentType = inferContentType(file);
  const allowed = ALLOWED_TYPES[kind];
  if (!contentType || !allowed.includes(contentType)) {
    throw new Error(
      `Tipo de arquivo não permitido${contentType ? ` (${contentType})` : ''}. Permitidos: ${allowed.join(', ')}.`,
    );
  }

  return { contentType, safeName: storageSafeFileName(file.name) };
}
