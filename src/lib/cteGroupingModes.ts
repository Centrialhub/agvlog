/**
 * 14 modos de agrupamento de CT-e por cliente.
 * Referência (memória): mem://funcionalidades/cte-modos-faturamento-cliente
 */
import type { FiscalDocument } from '@/hooks/useFiscalDocuments';

type GroupableFiscalDocument = FiscalDocument & {
  numref?: string | null;
  order_id?: string | null;
  liv_cli?: string | null;
  cfop?: string | null;
  vehicle_plate?: string | null;
  pickup_point?: string | null;
};

export interface GroupingMode {
  id: number;
  label: string;
  shortLabel: string;
  description: string;
  /** Campos que compõem a chave de agrupamento (apenas referência informativa para a UI). */
  keys: string[];
  /** Função que gera a chave para agrupar um documento fiscal. */
  keyFn: (d: GroupableFiscalDocument) => string;
}

const k = (...parts: (string | number | null | undefined)[]) =>
  parts.map(p => (p === null || p === undefined || p === '' ? '∅' : String(p).trim().toLowerCase())).join('|');

export const GROUPING_MODES: GroupingMode[] = [
  {
    id: 1,
    label: '1 - Conhecimentos Individuais',
    shortLabel: 'Individual',
    description: 'Um CT-e para cada nota fiscal (sem agrupamento).',
    keys: ['NF'],
    keyFn: (d) => k('individual', d.id),
  },
  {
    id: 2,
    label: '2 - Por Remetente, Destinatário, Romaneio e Numref',
    shortLabel: 'Rem + Dest + Rom.For + Numref',
    description: 'Agrupa por remetente, destinatário, romaneio do fornecedor e número de referência.',
    keys: ['Remetente', 'Destinatário', 'Rom.For', 'Numref'],
    keyFn: (d) => k(d.remitter, d.recipient, d.client_load_number, d.numref),
  },
  {
    id: 3,
    label: '3 - Por Remetente',
    shortLabel: 'Remetente',
    description: 'Agrupa todas as notas pelo mesmo remetente.',
    keys: ['Remetente'],
    keyFn: (d) => k(d.remitter),
  },
  {
    id: 4,
    label: '4 - Por Remetente, Destinatário e OS',
    shortLabel: 'Rem + Dest + OS',
    description: 'Agrupa por remetente, destinatário e ordem de serviço.',
    keys: ['Remetente', 'Destinatário', 'OS'],
    keyFn: (d) => k(d.remitter, d.recipient, d.order_id),
  },
  {
    id: 5,
    label: '5 - Por Remetente, Destinatário, Liv.cli e Numref',
    shortLabel: 'Rem + Dest + Liv.cli + Numref',
    description: 'Agrupa por remetente, destinatário, livro do cliente e número de referência.',
    keys: ['Remetente', 'Destinatário', 'Liv.cli', 'Numref'],
    keyFn: (d) => k(d.remitter, d.recipient, d.liv_cli, d.numref),
  },
  {
    id: 6,
    label: '6 - Por Remetente, Destinatário e CFOP',
    shortLabel: 'Rem + Dest + CFOP',
    description: 'Agrupa por remetente, destinatário e CFOP da operação.',
    keys: ['Remetente', 'Destinatário', 'CFOP'],
    keyFn: (d) => k(d.remitter, d.recipient, d.cfop),
  },
  {
    id: 7,
    label: '7 - CTRC/ORT por Remetente, Destinatário e Romaneio',
    shortLabel: 'CTRC/ORT por Rom.',
    description: 'CTRC/ORT agrupando remetente, destinatário e filtro por romaneio.',
    keys: ['Remetente', 'Destinatário', 'Romaneio'],
    keyFn: (d) => k(d.remitter, d.recipient, d.client_load_number),
  },
  {
    id: 8,
    label: '8 - CTRC/ORT por Lote',
    shortLabel: 'CTRC/ORT por Lote',
    description: 'CTRC/ORT agrupando todas as notas no mesmo lote selecionado.',
    keys: ['Lote'],
    keyFn: () => k('lote-unico'),
  },
  {
    id: 9,
    label: '9 - Por Remetente, Destinatário e Data de Emissão',
    shortLabel: 'Rem + Dest + Data NF',
    description: 'Agrupa por remetente, destinatário e data de emissão da NF.',
    keys: ['Remetente', 'Destinatário', 'Data Emissão'],
    keyFn: (d) => k(d.remitter, d.recipient, d.issue_date),
  },
  {
    id: 10,
    label: '10 - Por Remetente e Placa',
    shortLabel: 'Rem + Placa',
    description: 'Agrupa por remetente e placa do veículo.',
    keys: ['Remetente', 'Placa'],
    keyFn: (d) => k(d.remitter, d.vehicle_plate),
  },
  {
    id: 11,
    label: '11 - Por Remetente, Placa e Destinatário',
    shortLabel: 'Rem + Placa + Dest',
    description: 'Agrupa por remetente, placa e destinatário.',
    keys: ['Remetente', 'Placa', 'Destinatário'],
    keyFn: (d) => k(d.remitter, d.vehicle_plate, d.recipient),
  },
  {
    id: 12,
    label: '12 - Redespacho por Chave de Acesso e Recebedor',
    shortLabel: 'Redespacho',
    description: 'Conhecimentos de redespacho agrupando por chave de acesso e recebedor.',
    keys: ['Chave de Acesso', 'Recebedor'],
    keyFn: (d) => k(d.access_key, d.recipient),
  },
  {
    id: 13,
    label: '13 - Por Remetente CADGER e Numref',
    shortLabel: 'Rem CADGER + Numref',
    description: 'Agrupa por remetente cadastrado em CADGER e número de referência.',
    keys: ['Remetente CADGER', 'Numref'],
    keyFn: (d) => k(d.remitter, d.numref),
  },
  {
    id: 14,
    label: '14 - Por Remetente, Destinatário e Coleta',
    shortLabel: 'Rem + Dest + Coleta',
    description: 'Agrupa por remetente, destinatário e ponto de coleta.',
    keys: ['Remetente', 'Destinatário', 'Coleta'],
    keyFn: (d) => k(d.remitter, d.recipient, d.pickup_point),
  },
];

export function getGroupingMode(id: number): GroupingMode {
  return GROUPING_MODES.find(m => m.id === id) || GROUPING_MODES[0];
}

export interface CteGroupPreview {
  key: string;
  remitter: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  client_id: string | null;
  documents: FiscalDocument[];
  invoice_count: number;
  pallet_count: number;
  weight_kg: number;
  cargo_value: number;
  freight_value: number;
  load_ids: string[];
  fiscal_document_ids: string[];
}

/**
 * Aplica um modo de agrupamento sobre uma lista de documentos fiscais e retorna
 * a prévia dos CT-es que serão gerados.
 */
export function buildGroups(docs: FiscalDocument[], modeId: number): CteGroupPreview[] {
  const mode = getGroupingMode(modeId);
  const map = new Map<string, CteGroupPreview>();

  for (const d of docs) {
    const key = mode.keyFn(d);
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        remitter: d.remitter,
        recipient: d.recipient,
        recipient_city: d.recipient_city,
        recipient_state: d.recipient_state,
        client_id: d.client_id,
        documents: [],
        invoice_count: 0,
        pallet_count: 0,
        weight_kg: 0,
        cargo_value: 0,
        freight_value: 0,
        load_ids: [],
        fiscal_document_ids: [],
      };
      map.set(key, g);
    }
    g.documents.push(d);
    g.invoice_count += 1;
    g.pallet_count += d.pallet_count || 0;
    g.weight_kg += Number(d.weight_kg) || 0;
    g.cargo_value += Number(d.value) || 0;
    g.freight_value += Number(d.freight_value) || 0;
    g.fiscal_document_ids.push(d.id);
    if (d.load_id && !g.load_ids.includes(d.load_id)) g.load_ids.push(d.load_id);
  }

  return Array.from(map.values()).sort((a, b) => (a.remitter || '').localeCompare(b.remitter || ''));
}
