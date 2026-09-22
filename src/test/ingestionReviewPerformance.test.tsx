import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ValidationStep from '@/components/ingestion/ValidationStep';
import UploadStep from '@/components/ingestion/UploadStep';
import { parseNFeXml } from '@/lib/documentParsers';
import type { ValidatedDocument } from '@/lib/ingestionValidator';

vi.mock('@/components/ingestion/IngestionPreviewDialog', () => ({ default: () => null }));
afterEach(cleanup);

const source = parseNFeXml('<NFe><infNFe><ide><nNF>1</nNF></ide></infNFe></NFe>');
const docs: ValidatedDocument[] = Array.from({ length: 337 }, (_, index) => ({
  source: { ...source, invoiceNumber: String(index + 1) },
  fileName: `${index + 1}.xml`, validations: [], hasErrors: index === 336,
  hasWarnings: false, matchedClientId: 'client', matchedClientName: 'Cliente', isDuplicate: false,
}));
const props = {
  docs, orders: [], clients: [], onBack: vi.fn(), onNext: vi.fn(),
  onUpdateDoc: vi.fn(), onUpdateOrder: vi.fn(), onRemoveDoc: vi.fn(), onRemoveOrder: vi.fn(),
};

describe('review of the reported 337 XML batch', () => {
  it('mounts only 25 invoices, keeps the total and maps last-page actions to the original invoice', () => {
    const onRemoveDoc = vi.fn();
    render(<ValidationStep {...props} onRemoveDoc={onRemoveDoc} />);
    expect(screen.getAllByRole('button', { name: /^Remover NF / })).toHaveLength(25);
    expect(screen.getByText('Exibindo 1–25 de 337')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Última página' }));
    expect(screen.getAllByRole('button', { name: /^Remover NF / })).toHaveLength(12);
    expect(screen.getByText('Exibindo 326–337 de 337')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remover NF 337' }));
    expect(onRemoveDoc).toHaveBeenCalledWith(336);
    fireEvent.click(screen.getByRole('button', { name: 'Erros (1)' }));
    expect(screen.getByText('Exibindo 1–1 de 1')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Remover NF / })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remover NF 337' }));
    expect(onRemoveDoc).toHaveBeenLastCalledWith(336);
  });

  it('clamps the page after the last invoice on that page is removed', () => {
    const { rerender } = render(<ValidationStep {...props} docs={docs.slice(0, 26)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Última página' }));
    rerender(<ValidationStep {...props} docs={docs.slice(0, 25)} />);
    expect(screen.getByText('Exibindo 1–25 de 25')).toBeInTheDocument();
  });
});

describe('upload progress', () => {
  it('blocks repeated drops during reading and permits another batch after completion', () => {
    const onFiles = vi.fn();
    const uploadProps = { onFiles, onOrtFiles: vi.fn() };
    const { rerender } = render(<UploadStep {...uploadProps} readProgress={{ completed: 2, total: 337 }} />);
    const files = [new File(['<NFe/>'], 'note.xml')];
    fireEvent.drop(screen.getByRole('button'), { dataTransfer: { files } });
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Lendo arquivos: 2 de 337');
    rerender(<UploadStep {...uploadProps} readProgress={null} />);
    fireEvent.drop(screen.getByRole('button'), { dataTransfer: { files } });
    expect(onFiles).toHaveBeenCalledWith(files);
  });
});
