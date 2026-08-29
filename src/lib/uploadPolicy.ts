export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadKind = 'image' | 'proof' | 'financial';

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
]);
const PROOF_MIME_TYPES = new Set([...IMAGE_MIME_TYPES, 'application/pdf']);
const FINANCIAL_MIME_TYPES = new Set([
  ...PROOF_MIME_TYPES, 'application/xml', 'text/xml',
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  xml: 'application/xml',
};

export function validateUploadFile(file: File, kind: UploadKind): string {
  if (file.size <= 0) throw new Error('O arquivo está vazio.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('O arquivo excede o limite de 10 MB.');

  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = file.type.toLowerCase() || MIME_BY_EXTENSION[extension] || '';
  const allowed = kind === 'image'
    ? IMAGE_MIME_TYPES
    : kind === 'proof'
      ? PROOF_MIME_TYPES
      : FINANCIAL_MIME_TYPES;

  if (!allowed.has(mime)) {
    throw new Error(kind === 'image'
      ? 'Envie uma imagem JPEG, PNG, WebP, HEIC ou HEIF.'
      : kind === 'proof'
        ? 'Envie uma imagem ou PDF válido.'
        : 'Envie uma imagem, PDF ou XML válido.');
  }
  return mime;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Não foi possível ler o arquivo.'));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Validates the file's bytes in addition to browser-provided MIME metadata.
 * This is the final client-side gate immediately before Storage upload; server
 * policies still enforce tenant path and size independently.
 */
export async function validateUploadContent(file: File, kind: UploadKind): Promise<string> {
  const mime = validateUploadFile(file, kind);
  const bytes = await readBlobBytes(file.slice(0, 1_024));
  let valid = false;

  if (mime === 'image/jpeg') valid = startsWith(bytes, [0xff, 0xd8, 0xff]);
  else if (mime === 'image/png') valid = startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  else if (mime === 'image/webp') valid = ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
  else if (mime === 'image/heic' || mime === 'image/heif') {
    const brand = ascii(bytes, 8, 12).toLowerCase();
    valid = ascii(bytes, 4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand);
  } else if (mime === 'application/pdf') valid = ascii(bytes, 0, 5) === '%PDF-';
  else if (mime === 'application/xml' || mime === 'text/xml') {
    const source = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '').trimStart();
    valid = source.startsWith('<') && !/<!DOCTYPE/i.test(source) && !/<script[\s>]/i.test(source);
  }

  if (!valid) throw new Error('O conteúdo do arquivo não corresponde ao formato declarado.');
  return mime;
}

export function storageSafeFileName(name: string): string {
  return name.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-+\./g, '.')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 120) || 'arquivo';
}
