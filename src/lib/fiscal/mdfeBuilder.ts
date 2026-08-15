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

  // Adiciona validação de tomadores (infToma no Hub Fiscal v1)
  if (!input.documents || input.documents.length === 0) {
    missing.push('Documentos vinculados (CT-e/NF-e)');
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
        infMunDescarga: [
          {
            cMunDescarga: digits(input.destination.city_ibge),
            xMunDescarga: input.destination.city_name,
            infCTe: input.documents
              .filter(d => d.type === 'cte')
              .map(d => ({ chCTe: digits(d.key) })),
            infNFe: input.documents
              .filter(d => d.type === 'nfe')
              .map(d => ({ chNFe: digits(d.key) })),
          },
        ],
      },
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
      // O Hub v1 exige o grupo infToma quando ide/tpEmit=1 (Prestador de Transporte).
      infToma: [
        {
          infToma: {
            CNPJ: digits(input.emitter.cnpj),
          },
        },
      ],
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
