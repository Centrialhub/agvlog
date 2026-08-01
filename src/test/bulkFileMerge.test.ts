import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { uniqueFilename, mergePdfBlobs, zipFiles, runBulkDownload, summarizeBulkResult, blobToUint8 } from '@/lib/fiscal/bulkFileMerge';

async function makePdf(pages = 1): Promise<Blob> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300, 300]);
  const bytes = await doc.save();
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}

describe('uniqueFilename', () => {
  it('desambigua nomes repetidos', () => {
    const taken = new Set<string>();
    expect(uniqueFilename(taken, 'a.pdf')).toBe('a.pdf');
    expect(uniqueFilename(taken, 'a.pdf')).toBe('a (2).pdf');
    expect(uniqueFilename(taken, 'a.pdf')).toBe('a (3).pdf');
  });
});

describe('mergePdfBlobs', () => {
  it('junta PDFs somando as páginas', async () => {
    const files = [
      { label: '1', filename: '1.pdf', blob: await makePdf(1) },
      { label: '2', filename: '2.pdf', blob: await makePdf(2) },
    ];
    const res = await mergePdfBlobs(files);
    expect(res?.merged).toBe(2);
    expect(res?.pages).toBe(3);
  });

  it('ignora arquivos inválidos e relata falha', async () => {
    const failures: any[] = [];
    const res = await mergePdfBlobs([
      { label: 'ok', filename: 'ok.pdf', blob: await makePdf(1) },
      { label: 'ruim', filename: 'ruim.pdf', blob: new Blob(['não é pdf']) },
    ], f => failures.push(f));
    expect(res?.merged).toBe(1);
    expect(failures).toHaveLength(1);
  });

  it('retorna null quando nenhum PDF é legível', async () => {
    const res = await mergePdfBlobs([{ label: 'x', filename: 'x.pdf', blob: new Blob(['xx']) }]);
    expect(res).toBeNull();
  });
});

describe('zipFiles', () => {
  it('empacota todos os arquivos', async () => {
    const blob = await zipFiles([
      { label: 'a', filename: 'a.xml', blob: new Blob(['<a/>']) },
      { label: 'b', filename: 'a.xml', blob: new Blob(['<b/>']) },
    ]);
    const zip = await JSZip.loadAsync(await blobToUint8(blob));
    expect(Object.keys(zip.files).sort()).toEqual(['a (2).xml', 'a.xml']);
  });
});

describe('runBulkDownload', () => {
  it('gera um único PDF a partir de vários documentos', async () => {
    const result = await runBulkDownload({
      rows: [1, 2, 3],
      format: 'pdf',
      outputBase: 'lote',
      delayMs: 0,
      fetchOne: () => makePdf(1),
      labelOf: n => `CT-e ${n}`,
      filenameOf: n => `cte-${n}.pdf`,
    });
    expect(result.kind).toBe('pdf');
    expect(result.filename).toBe('lote.pdf');
    expect(result.pages).toBe(3);
    expect(result.failures).toHaveLength(0);
  });

  it('cai para ZIP em XML e mantém as falhas', async () => {
    const result = await runBulkDownload({
      rows: [1, 2],
      format: 'xml',
      outputBase: 'lote',
      delayMs: 0,
      concurrency: 1,
      fetchOne: n => (n === 2 ? Promise.reject(new Error('sem hub')) : Promise.resolve(new Blob(['<x/>']))),
      labelOf: n => `NFS-e ${n}`,
      filenameOf: n => `nfse-${n}.xml`,
    });
    expect(result.kind).toBe('zip');
    expect(result.ok).toBe(1);
    expect(result.failures[0].message).toBe('sem hub');
    expect(summarizeBulkResult(result, 2).tone).toBe('warning');
  });

  it('lança erro quando nada pôde ser baixado', async () => {
    await expect(runBulkDownload({
      rows: [1],
      format: 'pdf',
      outputBase: 'lote',
      delayMs: 0,
      fetchOne: () => Promise.reject(new Error('502 hub')),
      labelOf: () => 'x',
      filenameOf: () => 'x.pdf',
    })).rejects.toThrow('502 hub');
  });
});