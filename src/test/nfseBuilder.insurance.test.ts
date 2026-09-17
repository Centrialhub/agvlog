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
  cod_servico: '160201',
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
    expect(payload.servico[0].discriminacao).toBe('Frete de transporte');
  });

  it('propaga seguradora, apólice, averbação e valores na discriminação aceita pela NFS-e', () => {
    const { payload } = buildNFSeEmitPayload({ doc: { ...baseDoc, ...ins }, emitter, environment: 'homologation' });
    expect(payload.servico[0].discriminacao).toContain('Apólice: AP-2026-001');
    expect(payload.servico[0].discriminacao).toContain('Averbação: AV-99881');
  });

  it('imprime os dados do seguro na discriminação', () => {
    const { payload } = buildNFSeEmitPayload({ doc: { ...baseDoc, ...ins, notes: 'obs' }, emitter, environment: 'homologation' });
    expect(payload.servico[0].discriminacao).toContain('Apólice: AP-2026-001');
    expect(payload.servico[0].discriminacao).toContain('Averbação: AV-99881');
    expect(payload.servico[0].discriminacao).toContain('Seguradora: Seguradora Brasil');
    expect((payload as any).observacao).toBeUndefined();
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
  it('subtrai deduções e retenções do valor líquido enviado ao provedor',()=>{
    const result=buildNFSeEmitPayload({
      doc:{...baseDoc,valor_deducoes:10,iss_retido:true,valor_pis:1,valor_cofins:2},
      emitter,environment:'homologation',
    });
    expect(result.payload.servico[0].valor).toMatchObject({servico:100,pis:1,cofins:2});
    expect(result.payload.servico[0].iss).toMatchObject({retido:true,aliquota:5,valor:5});
  });
  it.each(['sandbox','homologation','production'] as const)('mantém %s no envelope', environment => {
    const result=buildNFSeEmitPayload({doc:baseDoc,emitter,environment});
    expect(result.environment).toBe(environment);
    expect((result.payload as any).ambiente).toBeUndefined();
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

describe('NFS-e — contrato Hub Fiscal 2026-08-27', () => {
  it('envia serviço como lista com código nacional e bloco ISS', () => {
    const result = buildNFSeEmitPayload({doc:baseDoc,emitter,environment:'production'});
    expect(result.payload).toMatchObject({
      naturezaOperacao:'1',
      rps:{numero:'10',serie:'1',tipo:1},
      servico:[{
        codigo:'160201',
        discriminacao:'Frete de transporte',
        valor:{servico:100},
        iss:{tipoTributacao:6,exigibilidade:1,retido:false,aliquota:5,valor:5},
      }],
    });
  });

  it('envia regime de apuração exigido para optante do Simples sem destacar ISS próprio', () => {
    const result = buildNFSeEmitPayload({
      doc:{...baseDoc,regime_tributario:'1'},
      emitter:{...emitter,regime_tributario:'simples'},
      environment:'production',
    });
    expect(result.payload.regimeApuracaoTributaria).toBe(1);
    expect(result.payload.servico[0].iss).toEqual({
      tipoTributacao:6,exigibilidade:1,retido:false,
    });
  });

  it('transporta as chaves modelo 55 das NF-e de origem', () => {
    const chave='29260614998371003215550000004411101880763852';
    const result = buildNFSeEmitPayload({
      doc:{...baseDoc,fiscal_document_ids:['source-1'],items:[{fiscal_document_id:'source-1',access_key:chave}]},
      emitter,environment:'production',
    });
    expect(result.payload.notasFiscais).toEqual([{chave}]);
  });

  it('bloqueia origem vinculada sem chave NF-e válida', () => {
    expect(()=>buildNFSeEmitPayload({
      doc:{...baseDoc,fiscal_document_ids:['source-1'],items:[{fiscal_document_id:'source-1',access_key:'123'}]},
      emitter,environment:'production',
    })).toThrow(/chave de acesso válida/);
  });

  it('bloqueia código de serviço legado que não atende ao contrato atual', () => {
    expect(()=>buildNFSeEmitPayload({
      doc:{...baseDoc,cod_servico:'11.04'},
      emitter,environment:'production',
    })).toThrow(/6 dígitos/);
  });

  it('converte o código legado 2010 de transporte para o código nacional', () => {
    const result=buildNFSeEmitPayload({
      doc:{...baseDoc,cod_servico:'2010'},
      emitter,environment:'production',
    });
    expect(result.payload.servico[0].codigo).toBe('160201');
  });
});
