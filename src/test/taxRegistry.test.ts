import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

import {
  BRASIL_API_REGISTRY_SOURCE, brasilApiCnpjEndpoint, buildCadastroEnvelope,
  parseBrasilApiCnpjResponse, parseCadastroResponse,
} from '../../supabase/functions/_shared/tax-registry';
import {
  officialStateRegistrationForParty,
  validateOfficialParty,
  type OfficialTaxProfile,
} from '@/lib/fiscal/taxRegistryClient';

const profile: OfficialTaxProfile = {
  id: 'profile',
  cnpj: '31459273000122',
  uf: 'MG',
  state_registration: '0032718520035',
  legal_name: 'CLIENTE TESTE LTDA',
  trade_name: 'CLIENTE TESTE',
  registry_status: 'active',
  status_code: '1',
  tax_regime: 'NORMAL',
  economic_activity_code: '4711302',
  official_address: {
    street: 'RUA OFICIAL',
    number: '100',
    complement: null,
    neighborhood: 'CENTRO',
    cityCode: '3132503',
    city: 'ITAMARANDIBA',
    state: 'MG',
    zip: '39670000',
  },
  verified_at: '2026-08-31T20:00:00Z',
};

describe('official tax registry contract', () => {
  it('returns the active official IE so a missing CT-e field can be completed before transmission', () => {
    expect(officialStateRegistrationForParty(profile.cnpj, [profile])).toBe(profile.state_registration);
    expect(officialStateRegistrationForParty('00000000000000', [profile])).toBeNull();
  });

  it('builds a scoped SOAP request without accepting XML injection', () => {
    const xml = buildCadastroEnvelope('mg', 'CNPJ', '31&459<273>000122');
    expect(xml).toContain('<UF>MG</UF>');
    expect(xml).toContain('<CNPJ>31&amp;459&lt;273&gt;000122</CNPJ>');
    expect(xml).toContain('versao="2.00"');
    expect(xml).not.toMatch(/>\s+</);
  });

  it('normalizes the official CadConsultaCadastro response and address', () => {
    const xml = `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>
      <retConsCad xmlns="http://www.portalfiscal.inf.br/nfe" versao="2.00">
        <infCons><verAplic>MG</verAplic><cStat>111</cStat><xMotivo>Consulta cadastro com uma ocorrência</xMotivo>
          <infCad><IE>0032718520035</IE><CNPJ>31459273000122</CNPJ><UF>MG</UF>
            <cSit>1</cSit><xNome>CLIENTE TESTE LTDA</xNome><xFant>CLIENTE TESTE</xFant>
            <xLgr>RUA OFICIAL</xLgr><nro>100</nro><xBairro>CENTRO</xBairro>
            <cMun>3132503</cMun><xMun>ITAMARANDIBA</xMun><CEP>39670000</CEP>
            <CNAE>4711302</CNAE><regApur>NORMAL</regApur>
          </infCad>
        </infCons>
      </retConsCad></soap:Body></soap:Envelope>`;
    const result = parseCadastroResponse(xml);
    expect(result.cStat).toBe(111);
    expect(result.records).toEqual([expect.objectContaining({
      cnpj: '31459273000122',
      stateRegistration: '0032718520035',
      registryStatus: 'active',
      address: expect.objectContaining({ city: 'ITAMARANDIBA', cityCode: '3132503' }),
    })]);
  });

  it('parses an escaped SOAP result returned inside the result element', () => {
    const xml = '<consultaCadastro4Result>&lt;retConsCad&gt;&lt;infCons&gt;&lt;cStat&gt;259&lt;/cStat&gt;&lt;xMotivo&gt;Contribuinte não localizado&lt;/xMotivo&gt;&lt;/infCons&gt;&lt;/retConsCad&gt;</consultaCadastro4Result>';
    expect(parseCadastroResponse(xml)).toEqual({
      cStat: 259,
      reason: 'Contribuinte não localizado',
      records: [],
    });
  });

  it('normalizes a public Receita CNPJ address for an unsupported state service', () => {
    expect(brasilApiCnpjEndpoint('14.998.371/0031-34'))
      .toBe('https://brasilapi.com.br/api/cnpj/v1/14998371003134');
    const record = parseBrasilApiCnpjResponse({
      cnpj: '14.998.371/0031-34', razao_social: 'J MACEDO S/A',
      descricao_situacao_cadastral: 'ATIVA', situacao_cadastral: 2,
      logradouro: 'RUA ESTADO DE ISRAEL', numero: '215', complemento: 'PREDIO I',
      bairro: 'COMERCIO', municipio: 'SALVADOR', uf: 'BA', cep: 40460620,
      codigo_municipio_ibge: 2927408, cnae_fiscal: 1062700,
    });
    expect(record).toEqual(expect.objectContaining({
      cnpj: '14998371003134', registryStatus: 'active', stateRegistration: null,
      address: expect.objectContaining({ city: 'SALVADOR', state: 'BA', cityCode: '2927408', zip: '40460620' }),
      raw: expect.objectContaining({ source: BRASIL_API_REGISTRY_SOURCE }),
    }));
  });

  it('keeps the NF-e IE when the federal public fallback supplies only identity and address', () => {
    expect(validateOfficialParty({ cnpj: profile.cnpj, stateRegistration: '72911823' }, [{
      ...profile,
      uf: 'BA',
      state_registration: null,
      source: BRASIL_API_REGISTRY_SOURCE,
    }])).toBeNull();
  });

  it('accepts a safely restored MG leading zero and rejects a different IE', () => {
    expect(validateOfficialParty({
      cnpj: profile.cnpj,
      stateRegistration: '32718520035',
    }, [profile])).toBeNull();
    expect(validateOfficialParty({
      cnpj: profile.cnpj,
      stateRegistration: '1234567890123',
    }, [profile])).toContain('não corresponde');
  });

  it('blocks inactive or mismatched establishments', () => {
    expect(validateOfficialParty({ cnpj: '00000000000000', stateRegistration: null }, [profile]))
      .toContain('não localizado');
    expect(validateOfficialParty({ cnpj: profile.cnpj, stateRegistration: profile.state_registration }, [
      { ...profile, registry_status: 'inactive' },
    ])).toContain('não está ativo');
  });
});
