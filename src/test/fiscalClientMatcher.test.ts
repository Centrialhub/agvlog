import { describe, expect, it } from 'vitest';
import { matchClientForFiscalDoc } from '@/lib/fiscalDocuments/clientMatcher';

const clients = [
  {
    id: 'branch-18',
    tax_id: '42.985.218/0018-30',
    company_name: 'COMERCIAL GALA LTDA',
    legal_name: 'COMERCIAL GALA LTDA',
    address_city: 'Bocaiuva',
  },
];

describe('fiscal client establishment matching', () => {
  it('never reuses another branch by name when the XML contains a different full CNPJ', () => {
    expect(matchClientForFiscalDoc({
      cnpj: '42.985.218/0005-16',
      name: 'COMERCIAL GALA LTDA',
      city: 'Pirapora',
      state: 'MG',
    }, clients)).toBeNull();
  });

  it('still accepts the exact establishment CNPJ', () => {
    expect(matchClientForFiscalDoc({
      cnpj: '42.985.218/0018-30',
      name: 'COMERCIAL GALA LTDA',
      city: 'Bocaiuva',
      state: 'MG',
    }, clients)).toMatchObject({ id: 'branch-18' });
  });

  it('may use name and city only when the source has no tax document', () => {
    expect(matchClientForFiscalDoc({
      cnpj: null,
      name: 'COMERCIAL GALA LTDA',
      city: 'Bocaiuva',
      state: 'MG',
    }, clients)).toMatchObject({ id: 'branch-18' });
  });
});