// Builds a Plugnotas/Hub Fiscal compatible NFS-e emission payload from the
// AGVLog internal document + emitter records. Keeps every field the prefectures
// commonly demand so the Hub does not reject the note for missing metadata.

import type { TenantEmitter } from '@/hooks/useEmitters';
import { buildInsuranceText, hasInsuranceData } from './insuranceText';
import { validateInsurance, onlyDigits as cnpjDigits } from './insuranceValidation';

function onlyDigits(v: any): string {
  return String(v ?? '').replace(/\D/g, '');
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nonEmpty<T extends Record<string, unknown>>(obj: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const inner = nonEmpty(v as any);
      if (Object.keys(inner).length) out[k] = inner;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export interface BuildNFSeInput {
  doc: any;                     // row from nfse_documents (or the pending form payload)
  emitter: TenantEmitter | null;
  environment?: 'sandbox' | 'production';
  callbackUrl?: string;
  /**
   * Nº da tentativa de envio (0 = primeira). O Hub Fiscal/PlugNotas deduplica
   * requisições pelo `idIntegracao`; em reenvios precisamos de um id novo,
   * senão a chamada é descartada e a nota nunca chega ao provedor.
   */
  attempt?: number;
}

export function buildNFSeEmitPayload({ doc, emitter, environment, callbackUrl, attempt = 0 }: BuildNFSeInput) {
  if (!emitter) throw new Error('Emitente fiscal não configurado');
  if (!doc?.cliente_cnpj || !doc?.cliente_nome) {
    throw new Error('Tomador (cliente) sem CNPJ/razão social');
  }

  const integrationId = attempt > 0 ? `${doc.id}-r${attempt}` : String(doc.id);

  const emitterCnpj = onlyDigits(emitter.cnpj);
  const env: 'sandbox' | 'production' =
    environment || (emitter as any)?.metadata?.environment || 'production';

  const end = (emitter.endereco || {}) as Record<string, any>;
  const totalServicos = num(doc.valor_servicos);
  const baseCalculo = num(doc.base_calculo || totalServicos);
  const aliquota = num(doc.aliquota_iss);
  const valorIss = num(doc.valor_iss || (baseCalculo * aliquota) / 100);

  const items = Array.isArray(doc.items) ? doc.items : [];
  const baseDiscriminacao = String(
    doc.description ||
      items.map((it: any) => `${it.description} (${num(it.quantity)}x R$ ${num(it.unit_value).toFixed(2)})`).join(' | ') ||
      'Serviço de transporte'
  );

  // Seguro da carga: mesmos campos do CT-e. O padrão ABRASF não tem bloco
  // próprio, então garantimos a impressão na discriminação + observação.
  const insurance = {
    insurer_name: doc.insurer_name,
    insurer_cnpj: doc.insurer_cnpj,
    insurer_policy: doc.insurer_policy,
    insurer_endorsement: doc.insurer_endorsement,
    insured_amount: doc.insured_amount,
    insurance_premium: doc.insurance_premium,
  };
  const hasInsurance = hasInsuranceData(insurance);
  if (hasInsurance) {
    const check = validateInsurance({
      name: doc.insurer_name,
      cnpj: doc.insurer_cnpj,
      policy: doc.insurer_policy,
      endorsement: doc.insurer_endorsement,
    });
    if (!check.ok) {
      throw new Error(`Dados do seguro inválidos: ${check.messages.join(' ')}`);
    }
  }
  const insuranceText = buildInsuranceText(insurance);

  const discriminacao = [baseDiscriminacao, insuranceText]
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);
  const observacao = [doc.notes || '', insuranceText].filter(Boolean).join(' — ').slice(0, 2000) || undefined;

  const payload = nonEmpty({
    // Identificação do RPS
    idIntegracao: integrationId,
    tipo: (doc.doc_type || 'RPS').toUpperCase(),
    natureza: doc.nat_operacao || undefined,
    ambiente: env === 'sandbox' ? 'homologacao' : 'producao',

    prestador: {
      cpfCnpj: emitterCnpj,
      inscricaoMunicipal: emitter.im || undefined,
      inscricaoEstadual: emitter.ie || undefined,
      razaoSocial: emitter.razao_social,
      nomeFantasia: emitter.nome_fantasia || undefined,
      endereco: {
        logradouro: end.logradouro || end.endereco || undefined,
        numero: end.numero || undefined,
        complemento: end.complemento || undefined,
        bairro: end.bairro || undefined,
        codigoCidade: emitter.city_code || end.city_code || end.codigo_ibge || undefined,
        descricaoCidade: end.municipio || end.cidade || undefined,
        estado: end.uf || undefined,
        cep: onlyDigits(end.cep) || undefined,
      },
    },

    tomador: {
      cpfCnpj: onlyDigits(doc.cliente_cnpj),
      razaoSocial: doc.cliente_nome,
      inscricaoMunicipal: (doc.cliente_im as string) || undefined,
      inscricaoEstadual: (doc.cliente_ie as string) || undefined,
      email: (doc.cliente_email as string) || undefined,
      endereco: {
        logradouro: doc.cliente_endereco || undefined,
        numero: doc.cliente_numero || undefined,
        complemento: doc.cliente_complemento || undefined,
        bairro: doc.cliente_bairro || undefined,
        codigoCidade: doc.cliente_cod_municipio || undefined,
        descricaoCidade: doc.cliente_municipio || undefined,
        estado: doc.cliente_uf || undefined,
        cep: onlyDigits(doc.cliente_cep) || undefined,
      },
    },

    servico: {
      codigoTributacaoMunicipio: doc.cod_trib_municipal || doc.cod_servico || undefined,
      codigoLocalPrestacao: doc.cod_municipio_prestacao || emitter.city_code || undefined,
      codigoCnae: doc.cnae || undefined,
      codigoServico: doc.cod_servico || undefined,
      discriminacao,
      issRetido: !!doc.iss_retido,
      exigibilidade: doc.exigibilidade_iss || 1, // 1 = exigível (default)
      valor: {
        servico: totalServicos,
        deducoes: num(doc.valor_deducoes),
        baseCalculo,
        aliquota,
        iss: valorIss,
        pis: num(doc.valor_pis),
        cofins: num(doc.valor_cofins),
        inss: num(doc.valor_inss),
        ir: num(doc.valor_ir),
        csll: num(doc.valor_csll),
        outrasRetencoes: num(doc.outras_retencoes),
        descontoIncondicionado: 0,
        descontoCondicionado: 0,
      },
      itens: items.map((it: any) => ({
        descricao: it.description,
        quantidade: num(it.quantity),
        valorUnitario: num(it.unit_value),
        valorTotal: num(it.total),
      })),
    },

    rps: {
      numero: doc.rps_number,
      serie: doc.series || '1',
      tipo: 'RPS',
      status: 'Normal',
      dataEmissao: doc.issue_date,
      competencia: (doc.issue_date || '').slice(0, 7),
    },

    pedido: doc.pedido || doc.reference_number || undefined,
    observacao,

    // Bloco extra de seguro — enviado ao Hub para auditoria/impressão quando
    // o provedor municipal suportar campos adicionais.
    seguro: hasInsurance
      ? {
          seguradora: (doc.insurer_name || '').trim() || undefined,
          cnpjSeguradora: cnpjDigits(doc.insurer_cnpj) || undefined,
          apolice: (doc.insurer_policy || '').trim() || undefined,
          averbacao: (doc.insurer_endorsement || '').trim() || undefined,
          valorSegurado: num(doc.insured_amount) || undefined,
          valorSeguro: num(doc.insurance_premium) || undefined,
        }
      : undefined,
  });

  return {
    emitterCnpj,
    environment: env,
    externalId: integrationId,
    callbackUrl,
    payload,
  };
}