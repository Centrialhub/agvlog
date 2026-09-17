import { describe, expect, it } from 'vitest';
import {
  buildRomaneioCityBlocks,
  renderRomaneioOverview,
  renderRomaneioRoutes,
  type RomaneioDoc,
} from '@/lib/romaneioPrint';

const dangerousDoc: RomaneioDoc = {
  city: 'São Paulo <script>alert(1)</script>',
  state: 'SP" onmouseover="alert(2)',
  remetente: '<img src=x onerror=alert(3)>',
  destinatario: 'Cliente & Filhos',
  bairro: '<svg/onload=alert(4)>',
  nfNumber: "NF'123",
  emissao: '16/09/2026',
  valor: 1250.5,
  peso: 42.25,
  volumes: 3,
};

describe('romaneio print renderer', () => {
  it('escapes every imported text field before writing printable HTML', () => {
    const rendered = renderRomaneioOverview([dangerousDoc], {
      title: '<title injection>',
      heading: '<script>heading()</script>',
      subtitle: 'Carga & conferência',
      footer: '<img onerror=footer>',
    });

    expect(rendered).not.toContain('<script>');
    expect(rendered).not.toContain('<img src=x');
    expect(rendered).not.toContain('<svg/onload');
    expect(rendered).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(rendered).toContain('Cliente &amp; Filhos');
    expect(rendered).toContain('NF&#39;123');
    expect(rendered).toContain('R$&nbsp;1.250,50'.replace('&nbsp;', ' '));
  });

  it('uses the same city grouping and totals for overview and route printing', () => {
    const second = {
      ...dangerousDoc,
      city: dangerousDoc.city,
      destinatario: 'Outro cliente',
      valor: 10,
      peso: 2,
      volumes: 1,
    };
    const totals = buildRomaneioCityBlocks([dangerousDoc, second]);
    const rendered = renderRomaneioRoutes([{
      routeName: '<Rota Centro>',
      vehicleInfo: '<Veículo malicioso>',
      driverInfo: 'Motorista & Cia',
      docs: [dangerousDoc, second],
    }], '<Rotas>');

    expect(totals.totalNotas).toBe(2);
    expect(totals.totalEntregas).toBe(2);
    expect(totals.totalValor).toBe(1260.5);
    expect(rendered).toContain('ROTA: &lt;ROTA CENTRO&gt;');
    expect(rendered).toContain('&lt;Veículo malicioso&gt; | Motorista &amp; Cia');
    expect(rendered.match(/<div class="city-section">/g)).toHaveLength(1);
    expect(rendered).toContain('Qtd Total Notas: 2');
  });
});
