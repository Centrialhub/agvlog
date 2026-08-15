import { describe, it, expect } from 'vitest';
import { buildNFSeEmitPayload } from '@/lib/fiscal/nfseBuilder';

const emitter: any = {
  cnpj: '11222333000181', razao_social: 'AGV Log', im: '123', ie: '456', city_code: '3106200',
  endereco: { uf: 'Minas Gerais', municipio: 'Janauba', logradouro: 'Av Central', numero: '100', bairro: 'Centro', cep: '39440-000' },
};
const doc: any = {
  id: 'd1', cliente_cnpj: '11.222.333/0001-81', cliente_nome: 'Cliente X',
  valor_servicos: 100, aliquota_iss: 5, issue_date: '2026-07-31', rps_number: '10',
  cod_servico: '11.04', description: 'Frete',
  cliente_municipio: 'Janauba', cliente_cod_municipio: '3106200', cliente_uf: 'Minas Gerais',
  cliente_cep: '39440-000', cliente_endereco: 'Rua A', cliente_bairro: 'Centro',
};

describe('NFS-e — endereço e identificação', () => {
  it('normaliza CEP, UF por extenso e usa S/N quando falta número', () => {
    const { payload } = buildNFSeEmitPayload({ doc, emitter });
    expect(payload.tomador.endereco.CEP).toBe('39440000');
    expect(payload.tomador.endereco.UF).toBe('MG');
    expect(payload.tomador.endereco.codigoCidade).toBe('3106200');
    expect(payload.tomador.endereco.numero).toBe('S/N');
    expect(payload.tomador.cpfCnpj).toBe('11222333000181');
  });

  it('nunca envia CEP fictício 00000000 — falha com mensagem clara', () => {
    expect(() => buildNFSeEmitPayload({ doc: { ...doc, cliente_cep: '' }, emitter }))
      .toThrow(/CEP do tomador/);
  });

  it('exige código IBGE do município do tomador', () => {
    // cliente_cod_municipio, cliente_municipio e cliente_cod_ibge são normalizados via normalizeIbgeCity
    expect(() => buildNFSeEmitPayload({ 
      doc: { 
        ...doc, 
        cliente_cod_municipio: null,
        cliente_municipio: 'Cidade Sem Codigo',
        cliente_cod_ibge: null 
      }, 
      emitter 
    }))
      .toThrow(/código IBGE/);
  });

  it('rejeita CNPJ com tamanho inválido', () => {
    expect(() => buildNFSeEmitPayload({ doc: { ...doc, cliente_cnpj: '123' }, emitter }))
      .toThrow(/CNPJ\/CPF do tomador/);
  });
});
