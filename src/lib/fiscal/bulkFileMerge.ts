import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';

export interface FetchedFile {
  /** Rótulo do documento (nº do CT-e/NFS-e) usado no nome do arquivo e nos erros. */
  label: string;
  filename: string;
  blob: Blob;
}

export interface BulkItemFailure {
  label: string;
  message: string;
}

export interface BulkResult {
  /** Arquivo final pronto para download (PDF único ou ZIP). */
  blob: Blob;
  filename: string;
  /** 'pdf' quando a junção deu certo, 'zip' quando caiu no fallback. */
  kind: 'pdf' | 'zip';
  ok: number;
  pages?: number;
  failures: BulkItemFailure[];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Evita nomes repetidos dentro do ZIP (`nota.pdf`, `nota (2).pdf`, ...). */
export function uniqueFilename(taken: Set<string>, filename: string): string {
  if (!taken.has(filename)) {
    taken.add(filename);
    return filename;
  }
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  let i = 2;
  let candidate = `${base} (${i})${ext}`;
  while (taken.has(candidate)) {
    i++;
    candidate = `${base} (${i})${ext}`;
  }
  taken.add(candidate);
  return candidate;
}

/** Lê o conteúdo binário do Blob (com fallback para ambientes sem Blob.arrayBuffer). */
export async function blobToUint8(blob: Blob): Promise<Uint8Array> {
  const arrayBuffer = (blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  if (typeof arrayBuffer === 'function') {
    return new Uint8Array(await arrayBuffer.call(blob));
  }
  // Ambientes sem Blob.arrayBuffer (ex.: jsdom nos testes) — usa FileReader.
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo'));
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buffer);
}

/**
 * Junta vários PDFs em um único documento, uma nota por página (ou mais, se a
 * nota original tiver várias páginas). Retorna null se nenhum PDF pôde ser lido.
 */
export async function mergePdfBlobs(
  files: FetchedFile[],
  onFailure?: (f: BulkItemFailure) => void,
): Promise<{ blob: Blob; pages: number; merged: number } | null> {
  const out = await PDFDocument.create();
  let merged = 0;
  for (const file of files) {
    try {
      const bytes = await blobToUint8(file.blob);
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      merged++;
    } catch (error: unknown) {
      onFailure?.({ label: file.label, message: errorMessage(error, 'PDF inválido para junção') });
    }
  }
  if (merged === 0) return null;
  const bytes = await out.save();
  return {
    blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }),
    pages: out.getPageCount(),
    merged,
  };
}

/** Empacota os arquivos baixados em um único ZIP. */
export async function zipFiles(files: FetchedFile[]): Promise<Blob> {
  const zip = new JSZip();
  const taken = new Set<string>();
  for (const file of files) {
    zip.file(uniqueFilename(taken, file.filename), file.blob);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export interface BulkDownloadOptions<T> {
  rows: T[];
  format: 'pdf' | 'xml';
  /** Baixa um documento do Hub. Deve lançar erro em caso de falha. */
  fetchOne: (row: T) => Promise<Blob>;
  labelOf: (row: T) => string;
  filenameOf: (row: T) => string;
  /** Nome base do arquivo final (sem extensão). */
  outputBase: string;
  onProgress?: (done: number, total: number, label: string) => void;
  /** Pausa entre requisições ao Hub, evitando rate limit. */
  delayMs?: number;
  /** Requisições simultâneas ao Hub. */
  concurrency?: number;
}

/**
 * Baixa em lote do Hub Fiscal e entrega UM único arquivo:
 * - PDF: todos os documentos unidos em um PDF (uma nota por página).
 * - XML (ou PDFs que não puderam ser unidos): um ZIP com os arquivos.
 */
export async function runBulkDownload<T>(opts: BulkDownloadOptions<T>): Promise<BulkResult> {
  const { rows, format, fetchOne, labelOf, filenameOf, outputBase } = opts;
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const delayMs = opts.delayMs ?? 150;
  const failures: BulkItemFailure[] = [];
  const fetched: FetchedFile[] = new Array(rows.length);
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < rows.length) {
      const index = cursor++;
      const row = rows[index];
      const label = labelOf(row);
      try {
        const blob = await fetchOne(row);
        if (!blob || blob.size === 0) throw new Error('Arquivo vazio retornado pelo Hub Fiscal');
        fetched[index] = { label, filename: filenameOf(row), blob };
      } catch (error: unknown) {
        failures.push({ label, message: errorMessage(error, 'Falha desconhecida') });
      }
      done++;
      opts.onProgress?.(done, rows.length, label);
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));

  const files = fetched.filter(Boolean);
  if (files.length === 0) {
    throw new Error(
      failures[0]?.message
        ? `Nenhum arquivo pôde ser baixado. Primeira falha: ${failures[0].message}`
        : 'Nenhum arquivo pôde ser baixado.',
    );
  }

  if (format === 'pdf') {
    const merged = await mergePdfBlobs(files, (f) => failures.push(f));
    if (merged) {
      return {
        blob: merged.blob,
        filename: `${outputBase}.pdf`,
        kind: 'pdf',
        ok: merged.merged,
        pages: merged.pages,
        failures,
      };
    }
  }

  return {
    blob: await zipFiles(files),
    filename: `${outputBase}.zip`,
    kind: 'zip',
    ok: files.length,
    failures,
  };
}

/** Texto de resumo (sucesso/falhas) do download em massa. */
export function summarizeBulkResult(
  result: BulkResult,
  total: number,
  maxDetail = 5,
): { tone: 'success' | 'warning' | 'error'; title: string; description?: string } {
  const what =
    result.kind === 'pdf'
      ? `PDF único com ${result.ok} nota(s)${result.pages ? ` / ${result.pages} página(s)` : ''}`
      : `ZIP com ${result.ok} arquivo(s)`;
  if (result.failures.length === 0) {
    return { tone: 'success', title: `${what} gerado` };
  }
  const detail = result.failures
    .slice(0, maxDetail)
    .map((f) => `${f.label}: ${f.message}`)
    .join(' | ');
  const extra =
    result.failures.length > maxDetail ? ` (+${result.failures.length - maxDetail} outras falhas)` : '';
  return {
    tone: result.ok === 0 ? 'error' : 'warning',
    title: `${what} — ${result.failures.length} de ${total} falharam`,
    description: detail + extra,
  };
}
