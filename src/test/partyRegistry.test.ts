import { describe, it, expect } from 'vitest';
import {
  buildClientIndex,
  findRegistryClient,
  resolveParty,
  fillPartyFieldsFromRegistry,
  normalizeName,
  sanitizeIe,
  type PartyFields,
} from '@/lib/fiscal/partyRegistry';

const clients = [
  {
    id: 'c1',
    company_name: 'J. MACEDO S/A',
    tax_id: '11.222.333/0001-44',
    state_registration: '1234567',
    address_street: 'Rua A',
    address_number: '10',
    address_neighborhood: 'Centro',
    address_city: 'Fortaleza',
    address_state: 'CE',
    address_zip: '60000000',
  },
  {
    id: 'c2',
    company_name: 'Supermercado Janaúba Ltda',
    tax_id: '99888777000166',
    state_registration: '7654321',
    address_city: 'Janaúba',
    address_state: 'MG',
  },
];

describe('partyRegistry', () => {
  const idx = buildClientIndex(clients);

  it('normaliza nomes ignorando acento e sufixo societário', () => {
    expect(normalizeName('Supermercado Janaúba Ltda')).toBe('SUPERMERCADO JANAUBA');
  });

  it('acha por CNPJ formatado', () => {
    expect(findRegistryClient(idx, { cnpj: '11222333000144' })?.id).toBe('c1');
  });

  it('acha por nome quando a NF não tem CNPJ', () => {
    expect(findRegistryClient(idx, { name: 'supermercado janauba ltda' })?.id).toBe('c2');
  });

  it('acha por id do cliente', () => {
    expect(findRegistryClient(idx, { id: 'c2' })?.id).toBe('c2');
  });

  it('completa CNPJ, IE e endereço a partir do cadastro', () => {
    const p = resolveParty(idx, { name: 'J. MACEDO S/A' });
    expect(p?.cnpj).toBe('11222333000144');
    expect(p?.ie).toBe('1234567');
    expect(p?.address?.city).toBe('Fortaleza');
  });

  it('preserva dados informados e usa cadastro só nas lacunas', () => {
    const p = resolveParty(idx, { name: 'J. MACEDO S/A', cnpj: '11222333000144', ie: '999' });
    expect(p?.ie).toBe('999');
  });

  it('usa cidade/UF da NF quando o cadastro não tem endereço', () => {
    const p = resolveParty(buildClientIndex([]), { name: 'X' }, { city: 'Montes Claros', state: 'MG' });
    expect(p?.address?.city).toBe('Montes Claros');
  });

  it('retorna null sem nome e sem cadastro', () => {
    expect(resolveParty(idx, { name: '' })).toBeNull();
  });

  it('preenche campos do diálogo sem sobrescrever o que já existe', () => {
    const item: PartyFields = {
      remitterName: 'J. MACEDO S/A',
      remitterCnpj: '',
      remitterIe: '',
      recipientName: 'Supermercado Janaúba Ltda',
      recipientCnpj: '',
      recipientIe: '',
      recipientCity: 'Janauba',
      recipientState: '',
      clientId: null,
    };
    const { item: out, changed } = fillPartyFieldsFromRegistry(item, idx);
    expect(changed).toBe(true);
    expect(out.remitterCnpj).toBe('11222333000144');
    expect(out.remitterIe).toBe('1234567');
    expect(out.recipientCnpj).toBe('99888777000166');
    expect(out.recipientCity).toBe('Janauba');
    expect(out.recipientState).toBe('MG');
  });

  it('não marca changed quando nada falta', () => {
    const item: PartyFields = {
      remitterName: 'J. MACEDO S/A',
      remitterCnpj: '11222333000144',
      remitterIe: '1234567',
      recipientName: 'Supermercado Janaúba Ltda',
      recipientCnpj: '99888777000166',
      recipientIe: '7654321',
      recipientCity: 'Janauba',
      recipientState: 'MG',
      clientId: null,
    };
    expect(fillPartyFieldsFromRegistry(item, idx).changed).toBe(false);
  });

  it('sanitizeIe descarta marcadores inválidos e mantém ISENTO/dígitos', () => {
    expect(sanitizeIe('UNKNOWN')).toBeNull();
    expect(sanitizeIe('ilegível')).toBeNull();
    expect(sanitizeIe('  ')).toBeNull();
    expect(sanitizeIe('Isento')).toBe('ISENTO');
    expect(sanitizeIe('001.234.567/0089')).toBe('0012345670089');
  });

  it('não usa IE UNKNOWN do cadastro na resolução da parte', () => {
    const idxUnknown = buildClientIndex([
      { id: 'c9', company_name: 'SANTIAGO SUPERMERCADO LTDA', tax_id: '37646354000118', state_registration: 'UNKNOWN' },
    ]);
    const p = resolveParty(idxUnknown, { name: 'SANTIAGO SUPERMERCADO LTDA' });
    expect(p?.cnpj).toBe('37646354000118');
    expect(p?.ie).toBeNull();
  });

  it('limpa IE UNKNOWN já presente nos campos do diálogo', () => {
    const { item: out, changed } = fillPartyFieldsFromRegistry(
      {
        remitterName: 'J. MACEDO S/A',
        remitterCnpj: '11222333000144',
        remitterIe: '1234567',
        recipientName: 'SANTIAGO SUPERMERCADO LTDA',
        recipientCnpj: '37646354000118',
        recipientIe: 'UNKNOWN',
        recipientCity: 'Divisa Alegre',
        recipientState: 'MG',
        clientId: null,
      },
      idx,
    );
    expect(changed).toBe(true);
    expect(out.recipientIe).toBe('');
  });
});


describe('fiscal establishment identity',()=>{
 const index=buildClientIndex([
  {id:'head',company_name:'SUPERMERCADO AVIAO LTDA',tax_id:'20.560.843/0001-50',state_registration:'1882510110074'},
  {id:'branch',company_name:'SUPERMERCADO AVIAO LTDA',tax_id:'20.560.843/0002-30',state_registration:'1882510110155'},
 ]);
 it('uses the invoice CNPJ even if the linked client belongs to another branch',()=>{
  const party=resolveParty(index,{id:'branch',name:'SUPERMERCADO AVIAO LTDA',cnpj:'20560843000150'});
  expect(party).toMatchObject({cnpj:'20560843000150',ie:'1882510110074'});
 });
 it('does not borrow IE by name or ID when the invoice CNPJ has no registry match',()=>{
  expect(resolveParty(index,{id:'branch',name:'SUPERMERCADO AVIAO LTDA',cnpj:'20560843000311'})?.ie).toBeNull();
 });
 it('prefills the preview with the IE belonging to the invoice establishment',()=>{
  const {item}=fillPartyFieldsFromRegistry({clientId:'branch',recipientName:'SUPERMERCADO AVIAO LTDA',recipientCnpj:'20560843000150',recipientIe:'',recipientCity:'',recipientState:'',remitterName:'',remitterCnpj:'',remitterIe:''},index);
  expect(item.recipientIe).toBe('1882510110074');expect(item.recipientCnpj).toBe('20560843000150');
 });
});

it('carries contributor classification only from the matching establishment', () => {
  const index = buildClientIndex([{id: 'qa', tax_id: '11222333000181', company_name: 'QA', state_registration: null, ie_indicator: 'Contribuinte ICMS'}]);
  expect(resolveParty(index, {cnpj: '11222333000181', name: 'QA'})).toMatchObject({ie: null, ieIndicator: 'Contribuinte ICMS'});
  expect(resolveParty(index, {cnpj: '11222333000262', name: 'QA'})?.ieIndicator).toBeNull();
});
