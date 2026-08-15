import { describe, it, expect } from 'vitest';
import { buildNFSeEmitPayload } from '../lib/fiscal/nfseBuilder';

const emitter: any = {
  cnpj: '11222333000181', razao_social: 'AGV Log', im: '123', ie: '456', city_code: '3106200',
  regime_tributario: 'simples',
  endereco: { uf: 'Minas Gerais', municipio: 'Janauba', logradouro: 'Av Central', numero: '100', bairro: 'Centro', cep: '39440-000' },
};
const doc: any = {
  id: 'd1', cliente_cnpj: '11.222.333/0001-81', cliente_nome: 'Cliente X',
  valor_servicos: 100, aliquota_iss: 5, issue_date: '2026-07-31', rps_number: '10',
  cod_servico: '11.04', description: 'Frete',
  cliente_municipio: 'Janauba', cliente_cod_municipio: '3106200', cliente_uf: 'Minas Gerais',
  cliente_cep: '39440-000', cliente_endereco: 'Rua A', cliente_bairro: 'Centro',
};

describe('NFS-e — DEBUG ATUALIZADO', () => {
  it('garante que buildNFSeEmitPayload dispara erro quando falta CEP', () => {
    // Usamos um bloco try-catch manual para ter certeza absoluta do comportamento
    let errorCaught = false;
    try {
      buildNFSeEmitPayload({ doc: { ...doc, cliente_cep: '' }, emitter });
    } catch (e) {
      errorCaught = true;
    }
    expect(errorCaught).toBe(true);
  });
});
