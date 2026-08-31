import { describe, it, expect } from 'vitest';
import { buildNFSeEmitPayload } from '@/lib/fiscal/nfseBuilder';
import { buildInsuranceText, hasInsuranceData } from '@/lib/fiscal/insuranceText';

const emitter: any = {
  cnpj: '11222333000181', razao_social: 'AGV Log', im: '123', ie: '456',
  city_code: '3106200',
  endereco: { uf: 'MG', municipio: 'Janauba', logradouro: 'Av Central', numero: '100', bairro: 'Centro', cep: '39440000' },
};
const baseDoc: any = {
  id: 'doc-1', cliente_cnpj: '11222333000181', cliente_nome: 'Cliente X',
  valor_servicos: 100, aliquota_iss: 5, issue_date: '2026-07-31', rps_number: '10',
  description: 'Frete de transporte',
  cod_servico: '11.04',
  cliente_municipio: 'Janauba', cliente_cod_municipio: '3106200', cliente_uf: 'MG',
  cliente_cep: '39440000', cliente_endereco: 'Rua A', cliente_numero: '10', cliente_bairro: 'Centro',
};
const ins = {
  insurer_name: 'Seguradora Brasil', insurer_cnpj: '11222333000181',
  insurer_policy: 'AP-2026-001', insurer_endorsement: 'AV-99881',
  insured_amount: 50000, insurance_premium: 120.5,
};

describe('NFS-e — propagação do seguro', () => {
  it('não emite bloco de seguro quando não há dados', () => {
    const { payload } = buildNFSeEmitPayload({ doc: baseDoc, emitter, environment: 'homologation' });
    expect((payload as any).seguro).toBeUndefined();
    expect(payload.servico.discriminacao).toBe('Frete de transporte');
  });

  it('propaga seguradora, apólice, averbação e valores', () => {
    const { payload } = buildNFSeEmitPayload({ doc: { ...baseDoc, ...ins }, emitter, environment: 'homologation' });
    expect((payload as any).seguro).toMatchObject({
      seguradora: 'Seguradora Brasil',
      cnpjSeguradora: '11222333000181',
      apolice: 'AP-2026-001',
      averbacao: 'AV-99881',
      valorSegurado: 50000,
      valorSeguro: 120.5,
    });
  });

  it('imprime os dados do seguro na discriminação e na observação', () => {
    const { payload } = buildNFSeEmitPayload({ doc: { ...baseDoc, ...ins, notes: 'obs' }, emitter, environment: 'homologation' });
    expect(payload.servico.discriminacao).toContain('Apólice: AP-2026-001');
    expect(payload.servico.discriminacao).toContain('Averbação: AV-99881');
    expect(payload.servico.discriminacao).toContain('Seguradora: Seguradora Brasil');
    expect((payload as any).observacao).toContain('Averbação: AV-99881');
  });

  it('bloqueia emissão com seguro incompleto/inválido', () => {
    expect(() => {
      buildNFSeEmitPayload({ doc: { ...baseDoc, insurer_policy: 'AP-1' }, emitter, environment: 'homologation' });
    }).toThrow(/Dados do seguro inválidos/);
  });



  it('helpers de texto', () => {
    expect(hasInsuranceData(null)).toBe(false);
    expect(buildInsuranceText(ins)).toContain('Valor segurado: R$ 50.000,00');
  });
});

describe('NFS-e — ambiente fiscal obrigatório e consistente', () => {
  it.each(['sandbox','homologation','production'] as const)('mantém %s no envelope e no payload', environment => {
    const result=buildNFSeEmitPayload({doc:baseDoc,emitter,environment});
    expect(result.environment).toBe(environment);
    expect(result.payload.ambiente).toBe(environment==='production'?'producao':'homologacao');
  });
  it('não assume produção quando o ambiente não foi informado',()=>{
    expect(()=>buildNFSeEmitPayload({doc:baseDoc,emitter})).toThrow(/ambiente fiscal/);
  });
  it('preserva identidade de emissão em duas construções do mesmo documento',()=>{
    const input={doc:baseDoc,emitter,environment:'homologation' as const};
    expect(buildNFSeEmitPayload(input).externalId).toBe(buildNFSeEmitPayload(input).externalId);
  });
  it('bloqueia cadastro incompleto antes de enviar',()=>{
    expect(()=>buildNFSeEmitPayload({doc:baseDoc,emitter:{...emitter,im:null},environment:'homologation'})).toThrow(/inscrição municipal/);
  });
});

it.each(['123','XX', '123456789012345'])('blocks malformed payer identifier %s before dispatch',cliente_cnpj=>{expect(()=>buildNFSeEmitPayload({doc:{...baseDoc,cliente_cnpj},emitter,environment:'production'})).toThrow('CNPJ/CPF');});
