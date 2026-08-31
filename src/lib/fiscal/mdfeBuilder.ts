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
  environment: 'sandbox' | 'homologation' | 'production';
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
  renavam?: string | null;
  type?: string | null; // ex: '01' (Tração)
  bodyType?: string | null; // ex: '00' (Não aplicável)
}

export interface MdfeProprietor {
  cnpj?: string | null;
  cpf?: string | null;
  name: string;
  ie?: string | null;
  state: string;
  rntrc?: string | null;
  type: '0' | '1' | '2'; // 0=TAC-Agregado, 1=TAC-Independente, 2=Outros
}

export interface MdfeDocument {
  key: string; // Chave de acesso do CT-e ou NF-e
  type: 'cte' | 'nfe';
  destination?: MdfeLocation | null;
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

interface MdfeContractorAddressPayload {
  xLgr: string;
  nro: string;
  xBairro: string;
  cMun: string;
  xMun: string;
  UF: string;
  CEP: string;
}

interface MdfeMunicipalUnloadGroup {
  cMunDescarga: string;
  xMunDescarga: string;
  infCTe: Array<{
    chCTe: string;
    infSeg?: { xSeg: string; CNPJ: string };
    nApol?: string;
    nAv?: string[];
  }>;
  infNFe: Array<{ chNFe: string }>;
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
  contractorIe?: string | null;
  contractorAddress?: {
    street?: string | null;
    number?: string | null;
    neighborhood?: string | null;
    city_ibge?: string | null;
    city_name?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null;
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
  pesoBruto?: number;
  cMone?: string;
  takers?: Array<{
    cnpj: string;
    name: string;
    ie?: string | null;
    address?: {
      street?: string | null;
      number?: string | null;
      neighborhood?: string | null;
      city_ibge?: string | null;
      city_name?: string | null;
      state?: string | null;
      zip?: string | null;
    } | null;
  }>;
  payment?: MdfePayment | null;
  proprietor?: MdfeProprietor | null;
  valePedagio?: {
    cnpjFornecedor?: string | null;
    cnpjPagador?: string | null;
    numeroComprovante?: string | null;
    valor?: number | null;
  } | null;
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
  if (!(input.driver?.name || '').trim()) missing.push('Nome do motorista');
  if (digits(input.driver?.cpf).length !== 11) missing.push('CPF válido do motorista');
  if (!input.vehicle?.plate) missing.push('Placa do veículo');
  if (!input.documents?.length) missing.push('Documentos vinculados (CT-e/NF-e)');
  if (input.documents?.some(document => digits(document.key).length !== 44)) {
    missing.push('Chave de acesso válida dos documentos vinculados');
  }
  if (input.documents?.some(document => digits(document.destination?.city_ibge || input.destination?.city_ibge).length !== 7)) {
    missing.push('Município de descarga (IBGE) de todos os documentos');
  }
  if (input.documents?.some(document => !(document.destination?.city_name || input.destination?.city_name || '').trim())) {
    missing.push('Nome do município de descarga de todos os documentos');
  }
  if (!input.vehicle?.tara || input.vehicle.tara <= 0) {
    missing.push('Tara do veículo (obrigatório)');
  }
  if (digits(input.origin?.city_ibge).length !== 7) missing.push('Cidade de origem (IBGE)');
  if (!(input.origin?.city_name || '').trim()) missing.push('Nome da cidade de origem');
  if (digits(input.origin?.state).length !== 2) missing.push('Código IBGE da UF de origem');
  if (!input.insurance?.providerCnpj) missing.push('CNPJ da Seguradora');
  if (!input.insurance?.policyNumber) missing.push('Número da Apólice');
  if (!input.insurance?.providerName) missing.push('Nome da Seguradora');

  if (input.valePedagio) {
    if (digits(input.valePedagio.cnpjFornecedor).length !== 14) {
      missing.push('CNPJ válido do fornecedor do vale-pedágio');
    }
    if (!(input.valePedagio.numeroComprovante || '').trim()) {
      missing.push('Número do comprovante do vale-pedágio');
    }
    if (!(Number(input.valePedagio.valor) > 0)) {
      missing.push('Valor do vale-pedágio');
    }
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
          IE: digits(pay?.contractorIe) || 'ISENTO',
          vContrato: Number(pay?.contractValue || 0),
          indAntecipaAdiant: (pay?.advanceValue || 0) > 0 ? '1' : '0',
          vAdiant: Number(pay?.advanceValue || 0),
          indPag: isTermPayment ? '1' : '0', // 0 = à vista, 1 = a prazo
          ...(pay?.contractorAddress
            ? {
                enderContratante: {
                  xLgr: (pay.contractorAddress.street || '').slice(0, 60),
                  nro: (pay.contractorAddress.number || 'SN').slice(0, 60),
                  xBairro: (pay.contractorAddress.neighborhood || '').slice(0, 60),
                  cMun: digits(pay.contractorAddress.city_ibge),
                  xMun: (pay.contractorAddress.city_name || '').slice(0, 60),
                  UF: pay.contractorAddress.state || '',
                  CEP: digits(pay.contractorAddress.zip),
                },
              }
            : {}),
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
        qCarga: input.pesoBruto || 0,
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
              const party: {
                xNome: string;
                CPF?: string;
                CNPJ?: string;
                IE: string;
                enderContratante?: MdfeContractorAddressPayload;
              } = {
                xNome: t.name.slice(0, 60),
                ...(d.length === 11 ? { CPF: d } : { CNPJ: d }),
                IE: digits(t.ie) || 'ISENTO',
              };

              if (t.address) {
                party.enderContratante = {
                  xLgr: (t.address.street || '').slice(0, 60),
                  nro: (t.address.number || 'SN').slice(0, 60),
                  xBairro: (t.address.neighborhood || '').slice(0, 60),
                  cMun: digits(t.address.city_ibge),
                  xMun: (t.address.city_name || '').slice(0, 60),
                  UF: t.address.state || '',
                  CEP: digits(t.address.zip),
                };
              }

              return party;
            }),
            ...(infPag ? { infPag } : {}),
          },
          veicTracao: {
            placa: input.vehicle.plate,
            UF: input.vehicle.state,
            tara: input.vehicle.tara || 0,
            RNTRC: input.vehicle.rntrc || 'ISENTO',
            RENAVAM: digits(input.vehicle.renavam),
            tpVeic: input.vehicle.type || '01',
            tpCar: input.vehicle.bodyType || '00',
            ...(input.proprietor ? {
              prop: {
                ...(input.proprietor.cnpj ? { CNPJ: digits(input.proprietor.cnpj) } : { CPF: digits(input.proprietor.cpf) }),
                RNTRC: input.proprietor.rntrc || 'ISENTO',
                xNome: input.proprietor.name.slice(0, 60),
                IE: digits(input.proprietor.ie) || 'ISENTO',
                UF: input.proprietor.state,
                tpProp: input.proprietor.type,
              }
            } : {}),
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
          const destination = doc.destination || input.destination;
          const cMun = digits(destination.city_ibge);
          let group = acc.find(g => g.cMunDescarga === cMun);
          
          if (!group) {
            group = {
              cMunDescarga: cMun,
              xMunDescarga: destination.city_name,
              infCTe: [],
              infNFe: [],
            };
            acc.push(group);
          }

          if (doc.type === 'cte') {
            group.infCTe.push({ 
              chCTe: digits(doc.key),
              ...(input.insurance?.policyNumber ? {
                infSeg: {
                  xSeg: input.insurance.providerName.slice(0, 60),
                  CNPJ: digits(input.insurance.providerCnpj),
                },
                nApol: input.insurance.policyNumber,
                nAv: ['0'],
              } : {}),
            });
          } else {
            group.infNFe.push({ chNFe: digits(doc.key) });
          }

          return acc;
        }, [] as MdfeMunicipalUnloadGroup[]),
      },
      // Contrato de entrada do Hub Fiscal. O Hub converte este bloco para
      // infDoc/infMunDescarga e usa as chaves para identificar os tomadores.
      descarregamento: Array.from(
        input.documents.reduce((groups, document) => {
          const destination = document.destination || input.destination;
          const cityCode = digits(destination.city_ibge);
          const group = groups.get(cityCode) || {
            municipio: { codigoIBGE: cityCode, nome: destination.city_name },
            ctes: [] as Array<{ chave: string }>,
            nfes: [] as Array<{ chave: string }>,
          };
          const target = document.type === 'cte' ? group.ctes : group.nfes;
          target.push({ chave: digits(document.key) });
          groups.set(cityCode, group);
          return groups;
        }, new Map<string, {
          municipio: { codigoIBGE: string; nome: string };
          ctes: Array<{ chave: string }>;
          nfes: Array<{ chave: string }>;
        }>()),
      ).map(([, group]) => group),
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
        ...(input.valePedagio ? {
          valePed: [
            {
              CNPJForn: digits(input.valePedagio.cnpjFornecedor),
              ...(input.valePedagio.cnpjPagador ? { CNPJPg: digits(input.valePedagio.cnpjPagador) } : {}),
              nCompra: input.valePedagio.numeroComprovante || '0',
              vValePed: Number(input.valePedagio.valor || 0),
            }
          ]
        } : {}),
        contratantes: contractors.map(t => {
          const d = digits(t.cnpj);
          const c: {
            xNome: string;
            CPF?: string;
            CNPJ?: string;
            ie: string;
            enderContratante?: MdfeContractorAddressPayload;
          } = {
            xNome: t.name.slice(0, 60),
            ...(d.length === 11 ? { CPF: d } : { CNPJ: d }),
            ie: digits(t.ie) || 'ISENTO',
          };

          if (t.address) {
            c.enderContratante = {
              xLgr: (t.address.street || '').slice(0, 60),
              nro: (t.address.number || 'SN').slice(0, 60),
              xBairro: (t.address.neighborhood || '').slice(0, 60),
              cMun: digits(t.address.city_ibge),
              xMun: (t.address.city_name || '').slice(0, 60),
              UF: t.address.state || '',
              CEP: digits(t.address.zip),
            };
          }

          return c;
        }),
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
