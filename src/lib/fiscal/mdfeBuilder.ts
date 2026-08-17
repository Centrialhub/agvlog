/**
 * Builder para o payload de emissão de MDF-e via Hub Fiscal.
 * Alinhado com a API v1 (Agosto 2026).
 *
 * O MDF-e (Manifesto Eletrônico de Documentos Fiscais) consolida as cargas
 * de uma viagem, vinculando CT-es ou NFe-s ao veículo e condutor.
 */

export interface MdfeEmitter {
  cnpj: string;
  name: string;
  environment: 'sandbox' | 'production';
}

export interface MdfeDriver {
  name: string;
  cpf: string;
}

export interface MdfeVehicle {
  plate: string;
  state: string;
  tara?: number | null; // Tara em KG
  rntrc?: string | null;
  type?: string | null; // ex: '01' (Tração)
  bodyType?: string | null; // ex: '00' (Não aplicável)
}

export interface MdfeDocument {
  key: string; // Chave de acesso do CT-e ou NF-e
  type: 'cte' | 'nfe';
}

export interface MdfeLocation {
  city_ibge: string;
  city_name: string;
  state: string;
}

export interface MdfeInsurance {
  providerName: string;
  providerCnpj: string;
  policyNumber: string;
}

/** Parcela do pagamento a prazo (grupo infPrazo). */
export interface MdfePaymentInstallment {
  number?: string | number | null;
  dueDate?: string | null; // YYYY-MM-DD
  value?: number | null;
}

/**
 * Grupo de pagamento do tomador (infPag) exigido pela Nota Técnica de
 * piso mínimo de frete. Em MDF-e de carga fracionada a exigência costuma
 * ser dispensada, portanto este bloco é opcional.
 */
export interface MdfePayment {
  contractorName?: string | null;
  contractorDoc?: string | null; // CPF ou CNPJ do tomador/contratante
  contractValue?: number | null; // Valor total do contrato
  paymentCondition?: 'avista' | 'aprazo' | null;
  advanceValue?: number | null; // Adiantamento
  installments?: MdfePaymentInstallment[];
  bank?: {
    pixKey?: string | null;
    bankCode?: string | null;
    agency?: string | null;
    account?: string | null;
    ipefCnpj?: string | null; // CNPJ da Instituição de Pagamento Eletrônico
  } | null;
}

export interface BuildMdfePayloadInput {
  emitter: MdfeEmitter;
  driver: MdfeDriver;
  vehicle: MdfeVehicle;
  trailers?: MdfeVehicle[]; // Carretas
  origin: MdfeLocation;
  destination: MdfeLocation;
  documents: MdfeDocument[];
  insurance?: MdfeInsurance | null; // Seguro da carga (obrigatório para prestador)
  nature?: string;
  observations?: string | null;
  externalId?: string | null;
  valCarga?: number;
  cMone?: string;
  takers?: Array<{
    cnpj: string;
    name: string;
  }>;
  payment?: MdfePayment | null;
}

export interface BuildMdfePayloadResult {
  ok: boolean;
  payload: Record<string, unknown>;
  missing: string[];
}

function digits(v?: string | null): string {
  return (v || '').replace(/\D+/g, '');
}

/**
 * Constrói o payload para POST /hub_documents_emit?type=mdfe
 */
export function buildMdfePayload(input: BuildMdfePayloadInput): BuildMdfePayloadResult {
  const missing: string[] = [];

  if (!input.emitter?.cnpj) missing.push('CNPJ do emitente');
  if (!input.driver?.cpf) missing.push('CPF do motorista');
  if (!input.vehicle?.plate) missing.push('Placa do veículo');
  if (!input.documents?.length) missing.push('Documentos vinculados (CT-e/NF-e)');
  if (input.documents?.some(document => digits(document.key).length !== 44)) {
    missing.push('Chave de acesso válida dos documentos vinculados');
  }
  if (!input.vehicle?.tara || input.vehicle.tara <= 0) {
    missing.push('Tara do veículo (obrigatório)');
  }
  if (!input.origin?.city_ibge) missing.push('Cidade de origem (IBGE)');
  if (!input.insurance?.providerCnpj) missing.push('CNPJ da Seguradora');
  if (!input.insurance?.policyNumber) missing.push('Número da Apólice');
  if (!input.insurance?.providerName) missing.push('Nome da Seguradora');

  // Validação local de documentos
  if (!input.documents || input.documents.length === 0) {
    missing.push('Documentos vinculados (CT-e/NF-e)');
  }




  const contractors = (input.takers && input.takers.length > 0)
    ? input.takers
    : [{ cnpj: input.emitter.cnpj, name: input.emitter.name }];

  // Grupo de pagamento do tomador (infPag). Enviado apenas quando informado;
  // em carga fracionada (múltiplos CT-e) a exigência é normalmente dispensada.
  const pay = input.payment;
  const payDoc = digits(pay?.contractorDoc);
  const hasPayment = Boolean(pay && (payDoc || (pay.contractValue || 0) > 0));
  const isTermPayment = pay?.paymentCondition === 'aprazo';

  const infPag = hasPayment
    ? [
        {
          xNome: (pay?.contractorName || contractors[0]?.name || '').slice(0, 60),
          ...(payDoc.length === 11 ? { CPF: payDoc } : payDoc ? { CNPJ: payDoc } : {}),
          vContrato: Number(pay?.contractValue || 0),
          indAntecipaAdiant: (pay?.advanceValue || 0) > 0 ? '1' : '0',
          vAdiant: Number(pay?.advanceValue || 0),
          indPag: isTermPayment ? '1' : '0', // 0 = à vista, 1 = a prazo
          ...(isTermPayment && pay?.installments?.length
            ? {
                infPrazo: pay.installments
                  .filter(p => (p.value || 0) > 0 || p.dueDate)
                  .map((p, idx) => ({
                    nParcela: String(p.number ?? idx + 1),
                    dVenc: p.dueDate || '',
                    vParcela: Number(p.value || 0),
                  })),
              }
            : {}),
          infBanc: {
            PIX: pay?.bank?.pixKey || undefined,
            codBanco: pay?.bank?.bankCode || undefined,
            codAgencia: pay?.bank?.agency || undefined,
            conta: pay?.bank?.account || undefined,
            CNPJIPEF: digits(pay?.bank?.ipefCnpj) || undefined,
          },
        },
      ]
    : undefined;

  if (hasPayment) {
    if (!payDoc) missing.push('CPF/CNPJ do tomador (pagamento)');
    if (!(pay?.contractorName || '').trim()) missing.push('Nome/Razão Social do tomador');
    if (!((pay?.contractValue || 0) > 0)) missing.push('Valor total do contrato');
    if (!pay?.paymentCondition) missing.push('Condição de pagamento');
    const bank = pay?.bank;
    const hasBank = Boolean(
      bank?.pixKey || bank?.ipefCnpj || (bank?.bankCode && bank?.agency && bank?.account)
    );
    if (!hasBank) missing.push('Dados bancários ou de recebimento (Pix, banco/agência/conta ou CNPJ IPEF)');
    if (isTermPayment) {
      const parcels = (pay?.installments || []).filter(p => (p.value || 0) > 0 && p.dueDate);
      if (parcels.length === 0) missing.push('Detalhamento das parcelas (valor e vencimento)');
    }
  }

  const payload: Record<string, unknown> = {
    emitterCnpj: digits(input.emitter.cnpj),
    environment: input.emitter.environment || 'sandbox',
    externalId: input.externalId || undefined,
    payload: {
      ide: {
        cUF: digits(input.origin.state).slice(0, 2),
        tpEmit: '1', // 1=Prestador de serviço de transporte
        mod: '58',
        natureza: input.nature || 'PRESTACAO DE SERVICO DE TRANSPORTE',
      },
      tot: {
        vCarga: input.valCarga || 0,
        cMone: input.cMone || '098', // 098=BRL
      },
      emit: {
        cnpj: digits(input.emitter.cnpj),
        xNome: input.emitter.name,
      },
      infModal: {
        versaoModal: '3.00',
        rodo: {
          // Grupo canônico da SEFAZ para os contratantes/tomadores do serviço
          // (obrigatório quando tpEmit=1 - Prestador de Serviço de Transporte).
          infANTT: {
            RNTRC: input.vehicle.rntrc || 'ISENTO',
            infContratante: contractors.map(t => {
              const d = digits(t.cnpj);
              return d.length === 11
                ? { CPF: d, xNome: t.name }
                : { CNPJ: d, xNome: t.name };
            }),
            ...(infPag ? { infPag } : {}),
          },
          veicTracao: {
            placa: input.vehicle.plate,
            UF: input.vehicle.state,
            tara: input.vehicle.tara || 0,
            RNTRC: input.vehicle.rntrc || 'ISENTO',
            tpVeic: input.vehicle.type || '01',
            tpCar: input.vehicle.bodyType || '00',
          },
          condutor: [
            {
              xNome: input.driver.name,
              CPF: digits(input.driver.cpf),
            },
          ],
        },
      },
      infDoc: {
        infMunDescarga: input.documents.reduce((acc, doc) => {
          // Para MDF-e, o Hub espera que os documentos sejam agrupados por município de descarga.
          // Se tivermos múltiplos documentos para o mesmo município, eles devem ir no mesmo array infCTe/infNFe.
          // Como o input.destination é global por enquanto, agrupamos tudo nele.
          // TODO: Se suportarmos multi-paradas no futuro, o input.documents deve carregar seu próprio city_ibge.
          const cMun = digits(input.destination.city_ibge);
          let group = acc.find(g => g.cMunDescarga === cMun);
          
          if (!group) {
            group = {
              cMunDescarga: cMun,
              xMunDescarga: input.destination.city_name,
              infCTe: [],
              infNFe: [],
            };
            acc.push(group);
          }

          if (doc.type === 'cte') {
            group.infCTe.push({ chCTe: digits(doc.key) });
          } else {
            group.infNFe.push({ chNFe: digits(doc.key) });
          }

          return acc;
        }, [] as any[]),
      },
      // Contrato de entrada do Hub Fiscal. O Hub converte este bloco para
      // infDoc/infMunDescarga e usa as chaves para identificar os tomadores.
      descarregamento: [
        {
          municipio: {
            codigoIBGE: digits(input.destination.city_ibge),
            nome: input.destination.city_name,
          },
          ctes: input.documents
            .filter(document => document.type === 'cte')
            .map(document => ({ chave: digits(document.key) })),
          nfes: input.documents
            .filter(document => document.type === 'nfe')
            .map(document => ({ chave: digits(document.key) })),
        },
      ],
      infMunCarrega: [
        {
          cMunCarrega: digits(input.origin.city_ibge),
          xMunCarrega: input.origin.city_name,
        },
      ],
      seg: [
        {
          infResp: {
            respSeg: '1', // 1=Emitente do MDF-e
            CNPJ: digits(input.emitter.cnpj),
          },
          infSeg: {
            xSeg: input.insurance?.providerName || '',
            CNPJ: digits(input.insurance?.providerCnpj || ''),
          },
          nApol: input.insurance?.policyNumber || '',
          nAv: ['0'], // Conforme schema v1 exige array de strings
        },
      ],
      infToma: {
        toma: '1', // 1=Contratante do serviço (Tomador do CT-e)
      },
      // Quando tpEmit=1 (Prestador), é obrigatório informar ao menos um contratante no modal rodoviário.
      modalRodoviario: {
        rntrc: input.vehicle.rntrc || 'ISENTO',
        contratantes: contractors.map(t => ({
          xNome: t.name,
          cpfCnpj: digits(t.cnpj),
        })),
      },
      infAdic: {
        infCpl: input.observations || '',
      },
    },
  };

  return {
    ok: missing.length === 0,
    payload,
    missing,
  };
}
