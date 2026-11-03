import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ContractorCteReview from '@/components/ingestion/ContractorCteReview';
import { calculateNfeAccessKeyCheckDigit } from '@/lib/fiscalDocuments/nfeAccessKey';

const base = '3126111234567800019557001000000123100000001';
const key = base + calculateNfeAccessKeyCheckDigit(base);
const pdf = () => new File(['%PDF-1.7\nSynthetic DACTE fixture\n%%EOF'], 'dacte-qa.pdf', { type: 'application/pdf' });
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function choosePdf() {
  fireEvent.change(screen.getByLabelText('Selecionar XML ou PDF/DACTE do CT-e'), { target: { files: [pdf()] } });
  await screen.findByLabelText('Chave de acesso do CT-e');
}
async function fillPdf() {
  await choosePdf();
  fireEvent.change(screen.getByLabelText('Chave de acesso do CT-e'), { target: { value: key } });
  for (const [label, value] of [
    ['Razão social da transportadora contratante', 'Transportadora QA'], ['Inscrição estadual da contratante', '123456789'],
    ['UF da contratante', 'MG'], ['Código IBGE de início da prestação', '3143302'],
    ['Código IBGE de término da prestação', '3550308'], ['Data de emissão', '2026-11-03'],
    ['Ambiente do documento', 'production'], ['Logradouro da contratante', 'Rua QA'], ['Número do endereço', '1'],
    ['Bairro', 'Centro'], ['Município da contratante', 'Montes Claros'], ['Código IBGE do município da contratante', '3143302'],
  ]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByLabelText('Conferi os dados com o PDF/DACTE original.'));
}

describe('contractor CT-e import review', () => {
  it('requires explicit DACTE review and derives the fiscal identity from the access key', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<ContractorCteReview scopeKey="company-A:actor-A" onConfirm={save} />);
    await choosePdf();
    expect(screen.getByRole('button', { name: 'Importar CT-e de origem' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Chave de acesso do CT-e'), { target: { value: key } });
    expect(screen.getByLabelText('CNPJ da contratante')).toHaveValue('12345678000195');
    expect(screen.getByLabelText('Número do CT-e')).toHaveValue('123');
    expect(save).not.toHaveBeenCalled();
  });
  it('submits the original PDF only with reviewed metadata and waits for persistence confirmation', async () => {
    let finish!: () => void;
    const save = vi.fn().mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<ContractorCteReview scopeKey="company-A:actor-A" onConfirm={save} />);
    await fillPdf();
    fireEvent.click(screen.getByRole('button', { name: 'Importar CT-e de origem' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].name).toBe('dacte-qa.pdf');
    expect(save.mock.calls[0][1]).toMatchObject({ access_key: key, source_format: 'pdf', authorization_declared: false, authorization_protocol: null });
    expect(screen.queryByText('CT-e de origem importado com sucesso.')).not.toBeInTheDocument();
    finish();
    await screen.findByText('CT-e de origem importado com sucesso.');
  });
  it('preserves the form for retry when saving has no confirmation', async () => {
    const save = vi.fn().mockRejectedValue(new Error('Sem confirmação do servidor.'));
    render(<ContractorCteReview scopeKey="company-A:actor-A" onConfirm={save} />);
    await fillPdf(); fireEvent.click(screen.getByRole('button', { name: 'Importar CT-e de origem' }));
    await screen.findByText('Sem confirmação do servidor.');
    expect(screen.getByLabelText('Chave de acesso do CT-e')).toHaveValue(key);
    expect(screen.queryByText('CT-e de origem importado com sucesso.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importar CT-e de origem' })).toBeEnabled();
  });
  it('requires another review after changing the date or fiscal environment', async () => {
    const save = vi.fn();
    render(<ContractorCteReview scopeKey="company-A:actor-A" onConfirm={save} />);
    await fillPdf();
    const submit = screen.getByRole('button', { name: 'Importar CT-e de origem' });
    expect(submit).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Data de emissão'), { target: { value: '2026-11-02' } });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Conferi os dados com o PDF/DACTE original.'));
    fireEvent.change(screen.getByLabelText('Ambiente do documento'), { target: { value: 'homologation' } });
    expect(submit).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
  it('clears the original file and all metadata on a company or actor change', async () => {
    const save = vi.fn();
    const view = render(<ContractorCteReview scopeKey="company-A:actor-A" onConfirm={save} />);
    await fillPdf();
    view.rerender(<ContractorCteReview scopeKey="company-B:actor-A" onConfirm={save} />);
    expect(screen.queryByLabelText('Chave de acesso do CT-e')).not.toBeInTheDocument();
    expect(screen.queryByText('dacte-qa.pdf')).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
  it('rejects a fake PDF before presenting a fiscal review', async () => {
    render(<ContractorCteReview scopeKey="company-A:actor-A" onConfirm={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Selecionar XML ou PDF/DACTE do CT-e'), {
      target: { files: [new File(['not a PDF'], 'fake.pdf', { type: 'application/pdf' })] },
    });
    await screen.findByRole('alert');
    expect(screen.queryByLabelText('Chave de acesso do CT-e')).not.toBeInTheDocument();
  });
});
