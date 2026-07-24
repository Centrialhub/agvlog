/**
 * Builder puro para o payload de emissão de CT-e via Hub Fiscal.
 *
 * Recebe o contexto editado pelo operador (emitente, partes, tomador,
 * motorista, veículo, natureza, valores, NFs referenciadas) e devolve
 *
 *   { payload, warnings, missing, ok }
 *
 * `payload` já está no formato POST /hub_documents_emit?type=cte esperado
 * pelo Hub. `missing` lista os campos obrigatórios ausentes — a UI usa
 * isso para bloquear o botão "Transmitir".
 *
 * Sem side effects; totalmente coberto por src/test/cteBuilder.test.ts.
 */

export type CteTakerRole =
  | 'remetente'
  | 'destinatario'
  | 'expedidor'
  | 'recebedor'
  | 'terceiro';

export interface CteParty {
  name: string;
  cnpj?: string | null;
  cpf?: string | null;
  ie?: string | null;
  address?: {
    street?: string | null;
    number?: string | null;
    complement?: string | null;
    neighborhood?: string | null;
    city?: string | null;
    city_ibge?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null;
}

export interface CteEmitter {
  id: string;
  cnpj: string;
  ie?: string | null;
  name: string;
  environment: 'sandbox' | 'production';
  address?: CteParty['address'];
}

export interface CteDriver {
  id?: string | null;
  name: string;
  cpf?: string | null;
}

export interface CteVehicle {
  id?: string | null;
  plate: string;
  state?: string | null;
  renavam?: string | null;
}

export interface CteReferencedNf {
  access_key?: string | null;
  number?: string | null;
  series?: string | null;
  issue_date?: string | null;
  value?: number | null;
  weight_kg?: number | null;
}

export type CteDocType = '01' | '02' | '03' | '04'; // Normal, Complementar, Anulação, Substituição

export interface CteInsurer {
  name: string;
  cnpj?: string | null;
  policy?: string | null;      // apólice
  endorsement?: string | null; // averbação
  insured_amount?: number | null;
}

export interface CteFreightComposition {
  freight_weight?: number | null;      // frete peso
  delivery_fee?: number | null;        // valor entrega
  others?: number | null;
  insurance_pct?: number | null;
  insurance_value?: number | null;     // seguro R$
  dispatch?: number | null;            // despacho/paletização
  gris?: number | null;                // GRIS / valor GR
  toll?: number | null;                // pedágio
  tracking?: number | null;
  loading?: number | null;             // carga/descarga
  helper?: number | null;              // ajudante
  partner_freight?: number | null;
  carrier_freight?: number | null;
  suspended_taxes?: number | null;
}

export interface CteIcms {
  cst?: string | null;         // 00, 20, 40, 41, 51, 60, 90 (CST) ou 90 (CSOSN — Simples)
  embutido?: boolean;
  isento?: boolean;
  aliquota?: number | null;
  base?: number | null;
  valor?: number | null;
  st_base?: number | null;
  st_aliquota?: number | null;
  st_valor?: number | null;
}

export interface CteGnre {
  base?: number | null;
  aliquota?: number | null;
  valor_guia?: number | null;
  valor_frete?: number | null;
}

export interface CteCbsIbs {
  base?: number | null;
  cbs_aliquota?: number | null; // %
  cbs_valor?: number | null;
  ibs_aliquota?: number | null; // %
  ibs_valor?: number | null;
}

export interface CteCargoInfo {
  content?: string | null;           // conteúdo (CONFORME NF)
  species?: string | null;           // espécie
  items_count?: number | null;
  deliveries_count?: number | null;
  predominant_product?: string | null;
  cubed_weight?: number | null;
  container_value?: number | null;
}

export interface BuildCtePayloadInput {
  emitter: CteEmitter | null;
  remitter: CteParty | null;
  recipient: CteParty | null;
  expedidor?: CteParty | null;
  recebedor?: CteParty | null;
  consignee?: CteParty | null;
  insurer?: CteInsurer | null;
  takerRole: CteTakerRole;
  takerParty?: CteParty | null; // usado quando takerRole === 'terceiro'
  driver: CteDriver | null;
  vehicle: CteVehicle | null;
  documentType?: CteDocType;                // Tipo CTRC — default '01'
  vehicleType?: string | null;              // Tipo veículo SEFAZ (01,02,...)
  additionalPlates?: string[];              // Carretas
  distribution?: string | null;             // Tip Distribuição
  operation?: string | null;                // Operação
  issueDate?: string | null;                // Data de emissão (ISO)
  refNumber?: string | null;                // Nº Ref
  clientOrderNumber?: string | null;        // Nº Pedido Cliente
  freightPriority?: string | null;
  freightComposition?: CteFreightComposition | null;
  icms?: CteIcms | null;
  gnre?: CteGnre | null;
  cbsIbs?: CteCbsIbs | null;
  cargo?: CteCargoInfo | null;
  nature: string;
  cfop?: string | null;
  observations?: string | null;
  invoices: CteReferencedNf[];
  totals: {
    freight_value: number;
    cargo_value: number;
    weight_kg: number;
    pallet_count: number;
    ibs_value?: number | null;
    cbs_value?: number | null;
  };
  externalId?: string | null;
}

export interface BuildCtePayloadResult {
  ok: boolean;
  payload: Record<string, unknown>;
  missing: string[];
  warnings: string[];
}

function digits(v?: string | null): string {
  return (v || '').replace(/\D+/g, '');
}

function serializeParty(p: CteParty | null | undefined) {
  if (!p) return null;
  const cnpj = digits(p.cnpj);
  const cpf = digits(p.cpf);
  return {
    nome: p.name,
    cnpj: cnpj || undefined,
    cpf: cpf && !cnpj ? cpf : undefined,
    ie: p.ie || undefined,
    endereco: p.address
      ? {
          logradouro: p.address.street || undefined,
          numero: p.address.number || undefined,
          complemento: p.address.complement || undefined,
          bairro: p.address.neighborhood || undefined,
          municipio: p.address.city || undefined,
          codigoMunicipio: p.address.city_ibge || undefined,
          uf: p.address.state || undefined,
          cep: digits(p.address.zip) || undefined,
        }
      : undefined,
  };
}

const TAKER_INDEX: Record<CteTakerRole, number> = {
  remetente: 0,
  expedidor: 1,
  recebedor: 2,
  destinatario: 3,
  terceiro: 4,
};

export function buildCtePayload(input: BuildCtePayloadInput): BuildCtePayloadResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!input.emitter) missing.push('Emitente');
  else {
    if (!digits(input.emitter.cnpj)) missing.push('CNPJ do emitente');
  }
  if (!input.remitter) missing.push('Remetente');
  else if (!digits(input.remitter.cnpj) && !digits(input.remitter.cpf)) {
    missing.push('CNPJ/CPF do remetente');
  }
  if (!input.recipient) missing.push('Destinatário');
  else if (!digits(input.recipient.cnpj) && !digits(input.recipient.cpf)) {
    missing.push('CNPJ/CPF do destinatário');
  }
  // Motorista e veículo não bloqueiam a transmissão — quando ausentes,
  // o CT-e é emitido com "." (compatível com o TMS legado). Emite aviso.
  if (!input.driver || !input.driver.name) {
    warnings.push('Motorista não informado — CT-e será emitido com "."');
  }
  if (!input.vehicle || !input.vehicle.plate) {
    warnings.push('Veículo (placa) não informado — CT-e será emitido com "."');
  }
  if (!input.nature) missing.push('Natureza da operação');
  if (!input.invoices?.length) missing.push('NFs referenciadas');
  if (!input.totals || !(input.totals.freight_value > 0)) missing.push('Valor do frete');

  if (input.takerRole === 'terceiro' && !input.takerParty) {
    missing.push('Dados do tomador (terceiro)');
  }

  // NFs sem chave de acesso não bloqueiam a emissão, mas geram alerta.
  const withoutKey = (input.invoices || []).filter((n) => !n.access_key).length;
  if (withoutKey > 0) {
    warnings.push(`${withoutKey} NF(s) sem chave de acesso — o SEFAZ pode rejeitar.`);
  }

  const additionalPlates = (input.additionalPlates || [])
    .map((p) => (p || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean);

  const freightComposition = input.freightComposition
    ? Object.fromEntries(
        Object.entries(input.freightComposition).filter(([, v]) => v != null),
      )
    : undefined;

  const payload: Record<string, unknown> = {
    emitterCnpj: digits(input.emitter?.cnpj) || undefined,
    environment: input.emitter?.environment || 'sandbox',
    externalId: input.externalId || undefined,
    payload: {
      tipoCtrc: input.documentType || '01',
      naturezaOperacao: input.nature,
      cfop: input.cfop || undefined,
      dataEmissao: input.issueDate || undefined,
      numeroRef: input.refNumber || undefined,
      numeroPedidoCliente: input.clientOrderNumber || undefined,
      prioridadeFrete: input.freightPriority || undefined,
      tipoDistribuicao: input.distribution || undefined,
      operacao: input.operation || undefined,
      observacoes: input.observations || undefined,
      emitente: serializeParty(
        input.emitter
          ? {
              name: input.emitter.name,
              cnpj: input.emitter.cnpj,
              ie: input.emitter.ie,
              address: input.emitter.address,
            }
          : null,
      ),
      remetente: serializeParty(input.remitter),
      destinatario: serializeParty(input.recipient),
      expedidor: serializeParty(input.expedidor),
      recebedor: serializeParty(input.recebedor),
      consignatario: serializeParty(input.consignee),
      seguradora: input.insurer
        ? {
            nome: input.insurer.name,
            cnpj: digits(input.insurer.cnpj) || undefined,
            apolice: input.insurer.policy || undefined,
            averbacao: input.insurer.endorsement || undefined,
            valorSegurado: input.insurer.insured_amount ?? undefined,
          }
        : undefined,
      tomador: {
        tipo: TAKER_INDEX[input.takerRole],
        role: input.takerRole,
        ...(input.takerRole === 'terceiro' ? { dados: serializeParty(input.takerParty) } : {}),
      },
      motorista: {
        nome: input.driver?.name?.trim() || '.',
        cpf: input.driver?.cpf ? digits(input.driver.cpf) || undefined : undefined,
      },
      veiculo: {
        placa:
          (input.vehicle?.plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || '.',
        uf: input.vehicle?.state || undefined,
        renavam: input.vehicle?.renavam || undefined,
        tipo: input.vehicleType || undefined,
        carretas: additionalPlates.length ? additionalPlates : undefined,
      },
      valores: {
        valorFrete: Number(input.totals.freight_value.toFixed(2)),
        valorCarga: Number((input.totals.cargo_value || 0).toFixed(2)),
        pesoBrutoKg: Number((input.totals.weight_kg || 0).toFixed(3)),
        pallets: input.totals.pallet_count || 0,
        ibs: input.totals.ibs_value ?? undefined,
        cbs: input.totals.cbs_value ?? undefined,
      },
      composicaoFrete: freightComposition,
      icms: input.icms ? buildIcmsBlock(input.icms) : undefined,
      gnre: input.gnre
        ? Object.fromEntries(Object.entries(input.gnre).filter(([, v]) => v != null))
        : undefined,
      cbsIbs: input.cbsIbs
        ? Object.fromEntries(Object.entries(input.cbsIbs).filter(([, v]) => v != null))
        : undefined,
      mercadoria: input.cargo
        ? Object.fromEntries(Object.entries(input.cargo).filter(([, v]) => v != null && v !== ''))
        : undefined,
      notasFiscais: (input.invoices || []).map((n) => ({
        chave: digits(n.access_key) || undefined,
        numero: n.number || undefined,
        serie: n.series || undefined,
        dataEmissao: n.issue_date || undefined,
        valor: n.value ?? undefined,
        pesoKg: n.weight_kg ?? undefined,
      })),
    },
  };

  return {
    ok: missing.length === 0,
    payload,
    missing,
    warnings,
  };
}
