import { sanitizeIe } from './partyRegistry';

export interface CteRecipientAddressDraft {
  key: string;
  recipientStreet: string;
  recipientNumber: string;
  recipientNeighborhood: string;
  recipientCity: string;
  recipientState: string;
  recipientZip: string;
  recipientCityIbge: string;
}

export interface CteRemitterAddressDraft {
  key: string;
  remitterStreet: string;
  remitterNumber: string;
  remitterNeighborhood: string;
  remitterCity: string;
  remitterState: string;
  remitterZip: string;
  remitterCityIbge: string;
}

export const CTE_RECIPIENT_ADDRESS_LABELS = [
  'Logradouro do destinatário',
  'Número do endereço do destinatário',
  'Bairro do destinatário',
  'Município do destinatário',
  'UF do destinatário',
  'CEP do destinatário (8 dígitos)',
  'Código IBGE do município do destinatário',
] as const;

export const CTE_REMITTER_ADDRESS_LABELS = [
  'Logradouro do remetente',
  'Número do endereço do remetente',
  'Bairro do remetente',
  'Município do remetente',
  'UF do remetente',
  'CEP do remetente (8 dígitos)',
  'Código IBGE do município do remetente',
] as const;

const NFE_UF_BY_CODE: Readonly<Record<string, string>> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
  '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR',
  '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

export function stateFromNfeAccessKey(accessKey: string | null | undefined): string {
  const digits = String(accessKey || '').replace(/\D/g, '');
  if (digits.length !== 44) return '';
  return NFE_UF_BY_CODE[digits.slice(0, 2)] || '';
}

export function missingCteRecipientAddressFields(
  item: Pick<
    CteRecipientAddressDraft,
    | 'recipientStreet'
    | 'recipientNumber'
    | 'recipientNeighborhood'
    | 'recipientCity'
    | 'recipientState'
    | 'recipientZip'
    | 'recipientCityIbge'
  >,
): string[] {
  const missing: string[] = [];
  if (!item.recipientStreet.trim()) missing.push(CTE_RECIPIENT_ADDRESS_LABELS[0]);
  if (!item.recipientNumber.trim()) missing.push(CTE_RECIPIENT_ADDRESS_LABELS[1]);
  if (!item.recipientNeighborhood.trim()) missing.push(CTE_RECIPIENT_ADDRESS_LABELS[2]);
  if (!item.recipientCity.trim()) missing.push(CTE_RECIPIENT_ADDRESS_LABELS[3]);
  if (item.recipientState.trim().length !== 2) missing.push(CTE_RECIPIENT_ADDRESS_LABELS[4]);
  if (item.recipientZip.replace(/\D/g, '').length !== 8) missing.push(CTE_RECIPIENT_ADDRESS_LABELS[5]);
  if (item.recipientCityIbge.replace(/\D/g, '').length !== 7) missing.push(CTE_RECIPIENT_ADDRESS_LABELS[6]);
  return missing;
}

export function needsCteRecipientAddressAutocomplete(
  item: Parameters<typeof missingCteRecipientAddressFields>[0],
): boolean {
  return missingCteRecipientAddressFields(item).length > 0;
}

export function missingCteRemitterAddressFields(
  item: Omit<CteRemitterAddressDraft, 'key'>,
): string[] {
  const missing: string[] = [];
  if (!item.remitterStreet.trim()) missing.push(CTE_REMITTER_ADDRESS_LABELS[0]);
  if (!item.remitterNumber.trim()) missing.push(CTE_REMITTER_ADDRESS_LABELS[1]);
  if (!item.remitterNeighborhood.trim()) missing.push(CTE_REMITTER_ADDRESS_LABELS[2]);
  if (!item.remitterCity.trim()) missing.push(CTE_REMITTER_ADDRESS_LABELS[3]);
  if (item.remitterState.trim().length !== 2) missing.push(CTE_REMITTER_ADDRESS_LABELS[4]);
  if (item.remitterZip.replace(/\D/g, '').length !== 8) missing.push(CTE_REMITTER_ADDRESS_LABELS[5]);
  if (item.remitterCityIbge.replace(/\D/g, '').length !== 7) missing.push(CTE_REMITTER_ADDRESS_LABELS[6]);
  return missing;
}

export function needsCteRemitterAddressAutocomplete(
  item: Parameters<typeof missingCteRemitterAddressFields>[0],
): boolean {
  return missingCteRemitterAddressFields(item).length > 0;
}

export function needsCtePartyAddressAutocomplete(
  item: Parameters<typeof missingCteRecipientAddressFields>[0] &
    Parameters<typeof missingCteRemitterAddressFields>[0],
): boolean {
  return needsCteRecipientAddressAutocomplete(item) || needsCteRemitterAddressAutocomplete(item);
}

/**
 * Cadastro oficial tambem deve ser consultado quando o endereco ja esta
 * completo, mas uma das IEs ainda esta ausente. Sem isso, lotes mistos
 * conseguem iniciar a transmissao e falham apenas ao chegar no item sem IE.
 */
export function needsCtePartyRegistryEnrichment(
  item: Parameters<typeof missingCteRecipientAddressFields>[0] &
    Parameters<typeof missingCteRemitterAddressFields>[0] & {
      recipientIe?: string | null;
      remitterIe?: string | null;
    },
): boolean {
  return needsCtePartyAddressAutocomplete(item)
    || !sanitizeIe(item.recipientIe)
    || !sanitizeIe(item.remitterIe);
}

export function mergeCteRecipientAddress<T extends CteRecipientAddressDraft>(
  current: T,
  completed: T,
): T {
  const next = {
    ...current,
    recipientStreet: current.recipientStreet || completed.recipientStreet,
    recipientNumber: current.recipientNumber || completed.recipientNumber,
    recipientNeighborhood: current.recipientNeighborhood || completed.recipientNeighborhood,
    recipientCity: current.recipientCity || completed.recipientCity,
    recipientState: current.recipientState || completed.recipientState,
    recipientZip: current.recipientZip || completed.recipientZip,
    recipientCityIbge: current.recipientCityIbge || completed.recipientCityIbge,
  };

  return (
    next.recipientStreet === current.recipientStreet &&
    next.recipientNumber === current.recipientNumber &&
    next.recipientNeighborhood === current.recipientNeighborhood &&
    next.recipientCity === current.recipientCity &&
    next.recipientState === current.recipientState &&
    next.recipientZip === current.recipientZip &&
    next.recipientCityIbge === current.recipientCityIbge
  ) ? current : next;
}

export function mergeCtePartyAddresses<
  T extends CteRecipientAddressDraft & CteRemitterAddressDraft,
>(current: T, completed: T): T {
  const withRecipient = mergeCteRecipientAddress(current, completed);
  const next = {
    ...withRecipient,
    remitterStreet: current.remitterStreet || completed.remitterStreet,
    remitterNumber: current.remitterNumber || completed.remitterNumber,
    remitterNeighborhood: current.remitterNeighborhood || completed.remitterNeighborhood,
    remitterCity: current.remitterCity || completed.remitterCity,
    remitterState: current.remitterState || completed.remitterState,
    remitterZip: current.remitterZip || completed.remitterZip,
    remitterCityIbge: current.remitterCityIbge || completed.remitterCityIbge,
  };

  return (
    next === current || (
      next.recipientStreet === current.recipientStreet &&
      next.recipientNumber === current.recipientNumber &&
      next.recipientNeighborhood === current.recipientNeighborhood &&
      next.recipientCity === current.recipientCity &&
      next.recipientState === current.recipientState &&
      next.recipientZip === current.recipientZip &&
      next.recipientCityIbge === current.recipientCityIbge &&
      next.remitterStreet === current.remitterStreet &&
      next.remitterNumber === current.remitterNumber &&
      next.remitterNeighborhood === current.remitterNeighborhood &&
      next.remitterCity === current.remitterCity &&
      next.remitterState === current.remitterState &&
      next.remitterZip === current.remitterZip &&
      next.remitterCityIbge === current.remitterCityIbge
    )
  ) ? current : next;
}

/**
 * Mescla defaults carregados de forma assíncrona sem apagar edições/autofill
 * que aconteceram enquanto a RPC estava em andamento.
 *
 * Um campo só recebe o valor tardio quando ainda é idêntico ao snapshot que
 * iniciou a consulta. Isso evita que `cte_defaults_for_group` restaure o
 * rascunho incompleto depois que o cadastro oficial completou o endereço.
 */
export function mergeCteDraftAfterAsyncDefaults<T extends Record<string, unknown>>(
  base: T,
  current: T,
  defaults: T,
): T {
  let changed = false;
  const next = { ...defaults } as T;

  for (const key of Object.keys(current) as Array<keyof T>) {
    if (!Object.is(current[key], base[key])) {
      if (!Object.is(next[key], current[key])) changed = true;
      next[key] = current[key];
    }
  }

  if (!changed) {
    for (const key of Object.keys(defaults) as Array<keyof T>) {
      if (!Object.is(defaults[key], current[key])) {
        changed = true;
        break;
      }
    }
  }

  return changed ? next : current;
}
