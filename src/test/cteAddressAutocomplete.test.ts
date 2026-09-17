import { describe, expect, it } from 'vitest';
import {
  mergeCteDraftAfterAsyncDefaults,
  mergeCtePartyAddresses,
  mergeCteRecipientAddress,
  missingCteRemitterAddressFields,
  missingCteRecipientAddressFields,
  needsCtePartyAddressAutocomplete,
  needsCtePartyRegistryEnrichment,
  needsCteRecipientAddressAutocomplete,
  stateFromNfeAccessKey,
} from '@/lib/fiscal/cteAddressAutocomplete';

const complete = {
  key: 'cte-1',
  recipientStreet: 'Rua Teste',
  recipientNumber: '51',
  recipientNeighborhood: 'Centro',
  recipientCity: 'Pirapora',
  recipientState: 'MG',
  recipientZip: '39270-000',
  recipientCityIbge: '3151206',
};

const completeParties = {
  ...complete,
  remitterStreet: 'Avenida Origem',
  remitterNumber: '100',
  remitterNeighborhood: 'Industrial',
  remitterCity: 'São Paulo',
  remitterState: 'SP',
  remitterZip: '01001-000',
  remitterCityIbge: '3550308',
};

describe('CT-e recipient address autocomplete', () => {
  it('preserves official address fields filled while async defaults are loading', () => {
    const base = {
      key: 'cte-1',
      recipientStreet: '',
      recipientCityIbge: '',
      remitterStreet: '',
      driverName: '',
    };
    const completedWhileLoading = {
      ...base,
      recipientStreet: 'RUA OFICIAL',
      recipientCityIbge: '3157005',
      remitterStreet: 'RUA ESTADO DE ISRAEL',
    };
    const lateDefaults = {
      ...base,
      driverName: 'MOTORISTA DA CARGA',
    };

    expect(mergeCteDraftAfterAsyncDefaults(base, completedWhileLoading, lateDefaults)).toEqual({
      ...completedWhileLoading,
      driverName: 'MOTORISTA DA CARGA',
    });
  });

  it('applies async defaults to fields untouched since the request started', () => {
    const base = { key: 'cte-1', driverName: '', vehiclePlate: '' };
    const defaults = { key: 'cte-1', driverName: 'MOTORISTA', vehiclePlate: 'ABC1D23' };

    expect(mergeCteDraftAfterAsyncDefaults(base, base, defaults)).toEqual(defaults);
  });

  it('derives the remitter UF from a valid NF-e access key', () => {
    expect(stateFromNfeAccessKey('29260814998371003134550010005470231000000010')).toBe('BA');
    expect(stateFromNfeAccessKey('invalid')).toBe('');
  });

  it('detects every address field that would block dispatch', () => {
    const missing = missingCteRecipientAddressFields({
      ...complete,
      recipientStreet: '',
      recipientNumber: '',
      recipientNeighborhood: '',
      recipientCity: '',
      recipientState: '',
      recipientZip: '39270',
      recipientCityIbge: '',
    });

    expect(missing).toEqual([
      'Logradouro do destinatário',
      'Número do endereço do destinatário',
      'Bairro do destinatário',
      'Município do destinatário',
      'UF do destinatário',
      'CEP do destinatário (8 dígitos)',
      'Código IBGE do município do destinatário',
    ]);
    expect(needsCteRecipientAddressAutocomplete({ ...complete, recipientStreet: '' })).toBe(true);
  });

  it('fills only missing values and preserves user-entered address data', () => {
    const current = {
      ...complete,
      recipientStreet: 'Avenida informada pelo usuário',
      recipientNumber: '',
      recipientNeighborhood: '',
      recipientZip: '',
    };

    const merged = mergeCteRecipientAddress(current, complete);

    expect(merged).toMatchObject({
      recipientStreet: 'Avenida informada pelo usuário',
      recipientNumber: '51',
      recipientNeighborhood: 'Centro',
      recipientZip: '39270-000',
    });
    expect(needsCteRecipientAddressAutocomplete(merged)).toBe(false);
  });

  it('detects and merges missing remitter fields before dispatch', () => {
    const current = {
      ...completeParties,
      remitterStreet: '',
      remitterNumber: '',
      remitterCityIbge: '',
    };

    expect(missingCteRemitterAddressFields(current)).toEqual([
      'Logradouro do remetente',
      'Número do endereço do remetente',
      'Código IBGE do município do remetente',
    ]);
    expect(needsCtePartyAddressAutocomplete(current)).toBe(true);
    expect(mergeCtePartyAddresses(current, completeParties)).toMatchObject({
      remitterStreet: 'Avenida Origem',
      remitterNumber: '100',
      remitterCityIbge: '3550308',
    });
  });

  it('requests fiscal enrichment when only an IE is missing', () => {
    expect(needsCtePartyRegistryEnrichment({
      ...completeParties,
      remitterIe: '110042490114',
      recipientIe: '',
    })).toBe(true);

    expect(needsCtePartyRegistryEnrichment({
      ...completeParties,
      remitterIe: '110042490114',
      recipientIe: '0024536620083',
    })).toBe(false);
  });
});
