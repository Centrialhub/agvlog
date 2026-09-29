import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CteFreightInput } from '@/components/billing/CteFreightInput';
import { parseCteFreightAmount } from '@/lib/fiscal/cteFreightAmount';
import { applyCteFreightPatch, resolveCtePreviewFreight } from '@/lib/fiscal/ctePreviewFreight';
import { mergeCteDraftAfterAsyncDefaults } from '@/lib/fiscal/cteAddressAutocomplete';
import { buildCtePayload, type BuildCtePayloadInput } from '@/lib/fiscal/cteBuilder';
import type { CteGroupPreview } from '@/lib/cteGroupingModes';

afterEach(cleanup);
const draft = { freightValue: 100, fcFreightWeight: 100, icmsAliquota: 12,
  icmsEmbutido: false, icmsIsento: false, icmsBase: 100, icmsValor: 12, freightError: '' };
const group = (values: Array<number | null>): CteGroupPreview => ({
  key: 'group', documents: values.map((freight_value, index) => ({
    id: `nf-${index}`, freight_value, tenant_id: 'tenant-a', client_id: 'client-a',
    recipient: 'Destinatário', recipient_city: 'Pirapora', recipient_state: 'MG',
    remitter_cnpj: '11222333000181', value: 1000, weight_kg: 50, pallet_count: 2,
  })), freight_value: values.reduce<number>((sum, value) => sum + (value ?? 0), 0),
} as CteGroupPreview);

describe('pré-emissão: frete ausente', () => {
  it('calcula apenas notas sem frete, com o contexto próprio, preservando valores salvos', async () => {
    const calculate = vi.fn().mockResolvedValue({ success: true, value: 125.45 });
    const result = await resolveCtePreviewFreight(group([50, null]), 'tenant-a', [{ id: 'client-a', payer_group: 'Grupo A' }], calculate);
    expect(result).toEqual({ freightValue: 175.45, freightError: '' });
    expect(calculate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tenantId: 'tenant-a', clientId: 'client-a',
      supplierTaxIds: ['11222333000181'], destinationMunicipality: 'Pirapora', totalValue: 1000, totalWeight: 50, totalPallets: 2 }));
  });
  it('não apresenta soma parcial como frete completo se uma nota não calcular', async () => {
    const calculate = vi.fn().mockResolvedValue({ success: false, value: 0, error: 'Sem tabela compatível' });
    const result = await resolveCtePreviewFreight(group([50, null]), 'tenant-a', [{ id: 'client-a' }], calculate);
    expect(result.freightValue).toBe(0);
    expect(result.freightError).toContain('Sem tabela compatível');
  });
  it('preserva override manual e torna falha de consulta visível', async () => {
    const calculate = vi.fn().mockRejectedValue(new Error('Consulta indisponível'));
    const manual = group([80]); manual.documents[0].freight_overridden = true;
    expect((await resolveCtePreviewFreight(manual, 'tenant-a', [{ id: 'client-a' }], calculate)).freightValue).toBe(80);
    expect(calculate).not.toHaveBeenCalled();
    expect((await resolveCtePreviewFreight(group([null]), 'tenant-a', [{ id: 'client-a' }], calculate)).freightError).toContain('Consulta indisponível');
  });
  it('resposta atrasada não apaga a edição manual', () => {
    const base = { ...draft, freightValue: 0, fcFreightWeight: 0 };
    const manual = applyCteFreightPatch(base, { freightValue: 1234.56 });
    const merged = mergeCteDraftAfterAsyncDefaults(base, manual, { ...base, freightValue: 500 });
    expect(merged.freightValue).toBe(1234.56);
    expect(merged.fcFreightWeight).toBe(1234.56);
  });
});

describe('pré-emissão: entrada monetária e payload', () => {
  it.each([['1.234,56', 1234.56], ['1234,56', 1234.56], ['1234.56', 1234.56], ['12,', 12], ['', null], ['-10', null], ['abc', null], ['1,234', null]])(
    'interpreta %s sem truncar o valor', (text, value) => expect(parseCteFreightAmount(text)).toBe(value),
  );
  it('permite limpar e digitar centavos sem reformatar cada tecla', () => {
    function Editor() {
      const [value, setValue] = useState(100);
      return <><CteFreightInput value={value} onChange={setValue} /><output>{value}</output></>;
    }
    render(<Editor />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    for (const value of ['', '1', '12', '123', '1234', '1234,', '1234,5', '1234,56']) {
      fireEvent.change(input, { target: { value } });
      expect(input).toHaveValue(value);
    }
    expect(screen.getByRole('status')).toHaveTextContent('1234.56');
    fireEvent.change(input, { target: { value: 'inválido' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('0');
  });
  it('envia a base manual nova, sem o componente ou ICMS antigos', () => {
    const updated = applyCteFreightPatch(draft, { freightValue: 1234.56 });
    expect(updated.fcFreightWeight).toBe(1234.56);
    expect(updated.icmsValor).toBe(148.15);
    const input: BuildCtePayloadInput = {
      emitter: { id: 'emitter', cnpj: '18666510000168', name: 'Emissor de teste', environment: 'sandbox' },
      remitter: { name: 'Remetente', cnpj: '14998371003215' },
      recipient: { name: 'Destino', cnpj: '07734610000168', address: { street: 'Rua Teste', number: '1',
        neighborhood: 'Centro', city: 'Pirapora', state: 'MG', city_ibge: '3151206', zip: '39270000' } },
      insurer: { name: 'Seguradora', cnpj: '18666510000168', policy: 'AP-1', endorsement: 'AV-1' },
      takerRole: 'destinatario', driver: null, vehicle: null, nature: 'PRESTACAO',
      invoices: [{ access_key: '3'.repeat(44), number: '1', value: 1000 }],
      totals: { freight_value: updated.freightValue, cargo_value: 1000, weight_kg: 50, pallet_count: 2 },
      freightComposition: { freight_weight: updated.fcFreightWeight },
      icms: { cst: '00', aliquota: updated.icmsAliquota, base: updated.icmsBase, valor: updated.icmsValor, embutido: false },
    };
    const built = buildCtePayload(input);
    expect(built.ok).toBe(true);
    expect(built.payload).toMatchObject({ payload: { vPrest: { vTPrest: 1234.56, vRec: 1234.56 },
      valores: { valorFreteBase: 1234.56, valorIcms: 148.15 } } });
  });
});
