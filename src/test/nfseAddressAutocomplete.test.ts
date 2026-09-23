import { describe, expect, it } from 'vitest';
import {
  findActiveNFSeTaxProfile,
  canonicalizeNFSeTomadorPostalAddress,
  mergeOfficialProfileIntoNFSeTomador,
  missingNFSeTomadorFields,
  needsNFSeTomadorRegistryEnrichment,
} from '@/lib/fiscal/nfseAddressAutocomplete';
import type { TomadorData } from '@/lib/fiscal/nfseTomador';
import type { OfficialTaxProfile } from '@/lib/fiscal/taxRegistryClient';

const emptyTomador: TomadorData = {
  nome: 'JMacêdo S/A', cnpj: '14998371003134', ie: '72911823', im: '',
  endereco: '', numero: '', complemento: '', bairro: '', email: '', telefone: '',
  municipio: '', municipio_cod: '', uf: '', cep: '', cliente_id: null,
};

const profile: OfficialTaxProfile = {
  id: 'registry-1', cnpj: '14998371003134', uf: 'BA', state_registration: null,
  legal_name: 'J MACEDO S A', trade_name: 'JMacêdo', registry_status: 'active',
  status_code: '02', tax_regime: null, economic_activity_code: null,
  official_address: {
    street: 'ESTADO DE ISRAEL', number: '215', complement: null,
    neighborhood: 'COMERCIO', cityCode: '2927408', city: 'SALVADOR',
    state: 'BA', zip: '40460620',
  },
  source: 'BRASILAPI_MINHA_RECEITA_PUBLIC_DATA', verified_at: '2026-09-15T00:00:00Z',
};

describe('NFS-e tomador address autocomplete', () => {
  it('completes the payer address returned by the fiscal registry', () => {
    const completed = mergeOfficialProfileIntoNFSeTomador(emptyTomador, profile, 'BA');
    expect(completed).toMatchObject({
      endereco: 'ESTADO DE ISRAEL', numero: '215', bairro: 'COMERCIO',
      municipio: 'SALVADOR', municipio_cod: '2927408', uf: 'BA', cep: '40460620',
      ie: '72911823',
    });
    expect(missingNFSeTomadorFields(completed)).toEqual([]);
  });

  it('never overwrites an address already reviewed in the form', () => {
    const completed = mergeOfficialProfileIntoNFSeTomador({
      ...emptyTomador,
      endereco: 'Rua revisada', numero: '10', bairro: 'Centro', municipio: 'Salvador',
      municipio_cod: '2927408', uf: 'BA', cep: '40000000',
    }, profile);
    expect(completed).toMatchObject({ endereco: 'Rua revisada', numero: '10', cep: '40000000' });
  });

  it('accepts an active address profile even when the public source does not validate IE', () => {
    expect(findActiveNFSeTaxProfile('14.998.371/0031-34', [profile])).toBe(profile);
    expect(findActiveNFSeTaxProfile('14.998.371/0031-34', [{ ...profile, registry_status: 'inactive' }])).toBeNull();
  });

  it('lists every fiscal field that still blocks emission', () => {
    expect(missingNFSeTomadorFields(emptyTomador)).toEqual([
      'Logradouro do tomador', 'Bairro do tomador', 'Município do tomador',
      'Código IBGE do município do tomador', 'UF do tomador', 'CEP do tomador',
    ]);
  });

  it('consults the registry when the address is complete but the IE is missing', () => {
    const completeWithoutIe = mergeOfficialProfileIntoNFSeTomador({
      ...emptyTomador,
      ie: '',
    }, profile, 'BA');

    expect(missingNFSeTomadorFields(completeWithoutIe)).toEqual([]);
    expect(needsNFSeTomadorRegistryEnrichment(completeWithoutIe)).toBe(true);
    expect(needsNFSeTomadorRegistryEnrichment({ ...completeWithoutIe, ie: 'ISENTO' })).toBe(false);
  });

  it('replaces a retired CEP with the unique street and municipality match', async () => {
    const completed = mergeOfficialProfileIntoNFSeTomador(emptyTomador, profile, 'BA');
    const requests: string[] = [];
    const resolved = await canonicalizeNFSeTomadorPostalAddress(completed, async input => {
      requests.push(input);
      return input.includes('/40460620/')
        ? { ok: true, json: async () => ({ erro: true }) }
        : { ok: true, json: async () => [{
            cep: '40015-025', logradouro: 'Rua Estado de Israel', bairro: 'Comércio',
            localidade: 'Salvador', uf: 'BA', ibge: '2927408',
          }] };
    });

    expect(requests).toHaveLength(2);
    expect(resolved).toMatchObject({
      endereco: 'Rua Estado de Israel', bairro: 'Comércio', municipio: 'Salvador',
      municipio_cod: '2927408', uf: 'BA', cep: '40015025', numero: '215',
    });
  });

  it('does not replace a reviewed street with another street from a CEP in the same city', async () => {
    const completed = mergeOfficialProfileIntoNFSeTomador(emptyTomador, profile, 'BA');
    const requests: string[] = [];
    const resolved = await canonicalizeNFSeTomadorPostalAddress(completed, async input => {
      requests.push(input);
      return input.includes('/40460620/')
        ? { ok: true, json: async () => ({
            cep: '40460-620', logradouro: 'Rua de Outro Bairro', localidade: 'Salvador', uf: 'BA', ibge: '2927408',
          }) }
        : { ok: true, json: async () => [{
            cep: '40015-025', logradouro: 'Rua Estado de Israel', bairro: 'Comércio',
            localidade: 'Salvador', uf: 'BA', ibge: '2927408',
          }] };
    });
    expect(requests).toHaveLength(2);
    expect(resolved).toMatchObject({ endereco: 'Rua Estado de Israel', cep: '40015025' });
  });

  it('preserves the street for a municipality-wide CEP without a street', async () => {
    const completed = mergeOfficialProfileIntoNFSeTomador(emptyTomador, profile, 'BA');
    const resolved = await canonicalizeNFSeTomadorPostalAddress(completed, async () => ({
      ok: true, json: async () => ({ cep: '40460-620', logradouro: '', localidade: 'Salvador', uf: 'BA', ibge: '2927408' }),
    }));
    expect(resolved).toMatchObject({ endereco: 'ESTADO DE ISRAEL', cep: '40460620' });
  });

  it('rejects malformed exact CEP payloads without searching or changing the address', async () => {
    const completed = mergeOfficialProfileIntoNFSeTomador(emptyTomador, profile, 'BA');
    await expect(canonicalizeNFSeTomadorPostalAddress(completed, async () => ({
      ok: true, json: async () => null,
    }))).rejects.toThrow('resposta inválida');
  });

  it('does not accept an exact response for another CEP or a correction without CEP', async () => {
    const completed = mergeOfficialProfileIntoNFSeTomador(emptyTomador, profile, 'BA');
    const requests: string[] = [];
    await expect(canonicalizeNFSeTomadorPostalAddress(completed, async input => {
      requests.push(input);
      return input.includes('/40460620/')
        ? { ok: true, json: async () => ({
            cep: '40015-025', logradouro: 'Rua Estado de Israel', localidade: 'Salvador', uf: 'BA', ibge: '2927408',
          }) }
        : { ok: true, json: async () => [{
            logradouro: 'Rua Estado de Israel', localidade: 'Salvador', uf: 'BA', ibge: '2927408',
          }] };
    })).rejects.toThrow('não foi possível corrigi-lo de forma inequívoca');
    expect(requests).toHaveLength(2);
  });

  it('blocks a CEP mismatch when address search is ambiguous', async () => {
    const completed = mergeOfficialProfileIntoNFSeTomador(emptyTomador, profile, 'BA');
    await expect(canonicalizeNFSeTomadorPostalAddress(completed, async input =>
      input.includes('/40460620/')
        ? { ok: true, json: async () => ({ erro: true }) }
        : { ok: true, json: async () => [] },
    )).rejects.toThrow('não foi possível corrigi-lo de forma inequívoca');
  });
});
