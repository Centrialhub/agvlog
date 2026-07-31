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
  /** Regime tributário cadastrado: 'simples' | 'presumido' | 'real' | 'mei'. */
  taxRegime?: string | null;
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

/**
 * Calcula base e valor do ICMS respeitando o regime "por dentro" (embutido).
 *
 * Regras (layout CT-e SEFAZ):
 *  - Isento (CST 40/41/51 ou flag isento): vBC = 0, vICMS = 0.
 *  - Por fora (embutido=false): vBC = vTPrest, vICMS = vBC × pICMS/100.
 *  - Por dentro / embutido (embutido=true): vTPrest é o total a receber e já
 *    contém o ICMS. A base fiscal continua sendo vTPrest e o valor do imposto
 *    é vTPrest × pICMS/100. O frete cru exibido nos componentes é calculado
 *    separadamente como vTPrest − vICMS.
 *
 * `providedBase`/`providedValor` são respeitados apenas quando são coerentes
 * com o regime — caso o chamador ainda passe base = frete com embutido=true
 * (bug antigo), o cálculo é refeito por dentro.
 */
export function computeIcmsAmounts(params: {
  freight: number;
  aliq: number;
  embutido: boolean;
  isento: boolean;
  providedBase?: number | null;
  providedValor?: number | null;
}): { base: number; valor: number } {
  const { freight, aliq, embutido, isento } = params;
  if (isento || !(aliq > 0)) return { base: 0, valor: 0 };
  const round2 = (n: number) => Number(n.toFixed(2));
  const providedBase = params.providedBase != null ? Number(params.providedBase) : null;
  const providedValor = params.providedValor != null ? Number(params.providedValor) : null;
  if (embutido) {
    const base = providedBase != null && providedBase > 0 ? providedBase : freight;
    const valor = base * (aliq / 100);
    return { base: round2(base), valor: round2(valor) };
  }
  // Por fora
  const base = providedBase != null && providedBase > 0 ? providedBase : freight;
  const valor = providedValor != null ? providedValor : base * (aliq / 100);
  return { base: round2(base), valor: round2(valor) };
}

/**
 * Serializa o bloco de ICMS no formato esperado pelo Hub Fiscal (nomes alinhados ao layout CT-e SEFAZ):
 *  - CST (00, 20, 40, 41, 51, 60, 90) ou CSOSN (SN → "90" com indicador Simples)
 *  - vBC (base de cálculo), pICMS (alíquota %), vICMS (valor)
 *  - Indicadores: embutido (indICMSTomador), isento
 */
function buildIcmsBlock(
  icms: CteIcms,
  freightValue: number,
  taxRegime?: string | null,
): Record<string, unknown> {
  const cstRaw = (icms.cst || '').toString().toUpperCase();
  const regimeRaw = (taxRegime || '').toString().toLowerCase();
  const regimeIsSimples = regimeRaw === 'simples' || regimeRaw === 'mei';
  const isSimples = cstRaw === 'SN' || cstRaw === 'CSOSN' || regimeIsSimples;
  const cst = cstRaw === 'SN' || cstRaw === 'CSOSN' ? '90' : cstRaw || '00';
  const isento = icms.isento === true || cst === '40' || cst === '41' || cst === '51';
  const aliq = isento ? 0 : Number(icms.aliquota || 0);
  const embutido = icms.embutido === true;
  const { base, valor } = computeIcmsAmounts({
    freight: freightValue,
    aliq,
    embutido,
    isento,
    providedBase: icms.base ?? null,
    providedValor: icms.valor ?? null,
  });

  const block: Record<string, unknown> = {
    CST: cst,
    cst,
    regime: isSimples ? 'simples' : 'normal',
    // CRT / classificação tributária do serviço (DACTE): 1 = Simples Nacional, 3 = Regime normal.
    crt: isSimples ? 1 : 3,
    regimeTributario: isSimples ? 1 : 3,
    classificacaoTributaria: isSimples ? 'simples_nacional' : 'tributacao_normal',
    vBC: Number(base.toFixed(2)),
    pICMS: Number(aliq.toFixed(2)),
    vICMS: Number(valor.toFixed(2)),
    // Aliases legíveis mantidos por compatibilidade com o Hub Fiscal atual
    base: Number(base.toFixed(2)),
    aliquota: Number(aliq.toFixed(2)),
    valor: Number(valor.toFixed(2)),
    embutido,
    isento,
    // Indicadores SEFAZ: quando embutido, o ICMS está incluído no valor do serviço.
    indICMS: embutido ? 1 : 0,
    indIEToma: embutido ? 1 : 0,
  };

  // Substituição tributária (opcional)
  if (icms.st_base != null || icms.st_aliquota != null || icms.st_valor != null) {
    block.st = {
      vBCST: icms.st_base ?? undefined,
      pICMSST: icms.st_aliquota ?? undefined,
      vICMSST: icms.st_valor ?? undefined,
    };
  }

  return block;
}

const COMPONENT_LABELS: Record<keyof CteFreightComposition, string> = {
  freight_weight: 'FRETE PESO',
  delivery_fee: 'VALOR ENTREGA',
  others: 'OUTROS',
  insurance_pct: 'SEGURO %',
  insurance_value: 'SEGURO',
  dispatch: 'DESPACHO',
  gris: 'GRIS',
  toll: 'PEDAGIO',
  tracking: 'RASTREAMENTO',
  loading: 'CARGA/DESCARGA',
  helper: 'AJUDANTE',
  partner_freight: 'FRETE PARCEIRO',
  carrier_freight: 'FRETE TRANSPORTADORA',
  suspended_taxes: 'TRIBUTOS SUSPENSOS',
};

/**
 * Componentes do valor da prestação do serviço (bloco impresso no DACTE).
 * Garante sempre as linhas de destaque: FRETE PESO, SEGURO (quando houver) e ICMS.
 */
function buildComponentes(params: {
  composition?: CteFreightComposition | null;
  freightValue: number;
  insuranceValue?: number | null;
  icmsValor?: number | null;
}): { nome: string; valor: number }[] {
  const round2 = (n: number) => Number(n.toFixed(2));
  const comp = params.composition || {};
  const items: { nome: string; valor: number }[] = [];

  // Soma dos componentes acessórios informados (exclui frete peso e seguro %).
  // O total a receber já contém ICMS; portanto FRETE PESO é o valor cru:
  // total − ICMS − demais componentes.
  let accessories = 0;
  for (const [k, v] of Object.entries(comp)) {
    if (k === 'freight_weight' || k === 'insurance_pct') continue;
    const n = Number(v || 0);
    if (n > 0) accessories += n;
  }

  const freightWeight =
    Number(comp.freight_weight || 0) > 0
      ? Number(comp.freight_weight)
      : Math.max(params.freightValue - Number(params.icmsValor || 0) - accessories, 0) || params.freightValue;

  items.push({ nome: COMPONENT_LABELS.freight_weight, valor: round2(freightWeight) });

  const insurance = Number(params.insuranceValue ?? comp.insurance_value ?? 0);
  if (insurance > 0) items.push({ nome: COMPONENT_LABELS.insurance_value, valor: round2(insurance) });

  for (const [k, v] of Object.entries(comp)) {
    if (k === 'freight_weight' || k === 'insurance_pct' || k === 'insurance_value') continue;
    const n = Number(v || 0);
    if (n > 0) {
      items.push({ nome: COMPONENT_LABELS[k as keyof CteFreightComposition] || k.toUpperCase(), valor: round2(n) });
    }
  }

  const icms = Number(params.icmsValor || 0);
  if (icms > 0) items.push({ nome: 'ICMS', valor: round2(icms) });

  return items;
}

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

  const icmsBlock = input.icms
    ? buildIcmsBlock(input.icms, input.totals.freight_value, input.emitter?.taxRegime)
    : undefined;

  const insuranceValue = Number(input.freightComposition?.insurance_value || 0);
  const insuredAmount =
    input.insurer?.insured_amount ?? (input.insurer ? input.totals.cargo_value || null : null);
  if (!input.insurer?.name) {
    warnings.push(
      'Seguro da carga não informado — o DACTE sairá sem seguradora/averbação. Preencha a aba Seguro.',
    );
  }
  if (input.insurer?.name) {
    if (!input.insurer.policy) {
      warnings.push('Nº da apólice não informado — o DACTE sairá sem o número da apólice.');
    }
    if (!input.insurer.endorsement) {
      warnings.push('Nº da averbação não informado — o DACTE sairá sem o número da averbação.');
    }
  }

  // Seguro é obrigatório no fluxo operacional do AGVLog: sem estes dados o
  // Hub até pode autorizar, mas o bloco não é impresso no DACTE.
  if (!input.insurer?.name) missing.push('Seguradora da carga');
  if (!input.insurer?.policy) missing.push('Nº da apólice');
  if (!input.insurer?.endorsement) missing.push('Nº da averbação');

  const componentes = buildComponentes({
    composition: input.freightComposition,
    freightValue: input.totals.freight_value,
    insuranceValue,
    icmsValor: (icmsBlock?.vICMS as number) ?? null,
  });
  const totalServico = Number(input.totals.freight_value.toFixed(2));
  const icmsValue = Number((Number(icmsBlock?.vICMS) || 0).toFixed(2));
  const freteBase = Number(
    (componentes.find((component) => component.nome === 'FRETE PESO')?.valor || 0).toFixed(2),
  );
  const seguroCarga = input.insurer
    ? {
        responsavel: 4,
        respSeg: 4,
        nome: input.insurer.name,
        xSeg: input.insurer.name,
        cnpj: digits(input.insurer.cnpj) || undefined,
        apolice: input.insurer.policy || undefined,
        nApol: input.insurer.policy || undefined,
        averbacao: input.insurer.endorsement || undefined,
        nAver: input.insurer.endorsement ? [input.insurer.endorsement] : undefined,
        valorSegurado: insuredAmount ?? undefined,
        valorSeguro: insuranceValue > 0 ? Number(insuranceValue.toFixed(2)) : undefined,
      }
    : undefined;

  const emitterRegimeRaw = (input.emitter?.taxRegime || '').toString().toLowerCase();
  const emitterIsSimples = emitterRegimeRaw === 'simples' || emitterRegimeRaw === 'mei';
  const emitterRegimeCode = emitterIsSimples ? 1 : 3;
  if (!emitterRegimeRaw) {
    warnings.push(
      'Regime tributário do emitente não cadastrado — assumindo regime normal (CRT 3). Configure em Configurações → Emitentes para garantir a impressão do ICMS no DACTE.',
    );
  }

  const payload: Record<string, unknown> = {
    emitterCnpj: digits(input.emitter?.cnpj) || undefined,
    environment: input.emitter?.environment || 'sandbox',
    externalId: input.externalId || undefined,
    // Regime tributário do emitente — o Hub usa isso para a "Classificação
    // Tributária do Serviço" do DACTE. Sem ele o Hub cai no cadastro da
    // empresa (Simples Nacional) e o ICMS não é impresso.
    regimeTributario: emitterRegimeCode,
    payload: {
      regimeTributario: emitterRegimeCode,
      crt: emitterRegimeCode,
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
      seguradora: seguroCarga,
      seguro: seguroCarga,
      seguros: seguroCarga ? [seguroCarga] : undefined,
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
        valorFrete: totalServico,
        freteBase,
        valorFreteBase: freteBase,
        valorIcms: icmsValue,
        valorTotalServico: totalServico,
        valorPrestacao: totalServico,
        valorReceber: totalServico,
        vTPrest: totalServico,
        vRec: totalServico,
        valorCarga: Number((input.totals.cargo_value || 0).toFixed(2)),
        pesoBrutoKg: Number((input.totals.weight_kg || 0).toFixed(3)),
        pallets: input.totals.pallet_count || 0,
        ibs: input.totals.ibs_value ?? undefined,
        cbs: input.totals.cbs_value ?? undefined,
      },
      composicaoFrete: freightComposition,
      // Componentes do valor da prestação (DACTE) — FRETE PESO / SEGURO / ICMS em destaque
      componentes,
      componentesValorPrestacao: componentes,
      // Estrutura canônica do grupo vPrest do CT-e, além dos aliases do Hub.
      valorPrestacao: {
        vTPrest: totalServico,
        vRec: totalServico,
        Comp: componentes.map((component) => ({
          xNome: component.nome,
          vComp: component.valor,
        })),
      },
      icms: icmsBlock,
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
