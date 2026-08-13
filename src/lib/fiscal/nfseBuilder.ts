// Builds a Plugnotas/Hub Fiscal compatible NFS-e emission payload from the
// AGVLog internal document + emitter records. Keeps every field the prefectures
// commonly demand so the Hub does not reject the note for missing metadata.

import type { TenantEmitter } from '@/hooks/useEmitters';
import { buildInsuranceText, hasInsuranceData } from './insuranceText';
import { validateInsurance, onlyDigits as cnpjDigits } from './insuranceValidation';
import {
  onlyDigits,
  normalizeUf,
  normalizeCep,
  normalizeIbgeCity,
  normalizeCityName,
  normalizeCpfCnpj,
  normalizePhone,
  fiscalText,
  money,
  isValidEmail,
} from './fiscalAddress';
import { sanitizeIe } from './partyRegistry';

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

  // ---------------------------------------------------------------------------
  // Validação e normalização do TOMADOR. Todo campo abaixo é exigido pelos
  // provedores municipais; falhar aqui (com mensagem clara) é melhor do que
  // enviar dado inventado e receber rejeição genérica do Hub Fiscal.
  // ---------------------------------------------------------------------------
  const missing: string[] = [];

  const tomadorDoc = normalizeCpfCnpj(doc?.cliente_cnpj);
  if (!doc?.cliente_cnpj) missing.push('CNPJ/CPF do tomador');
  const tomadorNome = fiscalText(doc?.cliente_nome, 150);
  if (!tomadorNome) missing.push('razão social do tomador');

  const tomadorCityName = normalizeCityName(doc?.cliente_municipio);
  const tomadorCityCode =
    normalizeIbgeCity(doc?.cliente_cod_municipio) || normalizeIbgeCity(doc?.cliente_municipio) || normalizeIbgeCity(doc?.cliente_cod_ibge);
  if (!tomadorCityName) missing.push('município do tomador');

  const tomadorUf = normalizeUf(doc?.cliente_uf);
  if (!tomadorUf) missing.push('UF do tomador');

  const tomadorCep = normalizeCep(doc?.cliente_cep);
  if (!tomadorCep) missing.push('CEP do tomador');

  const tomadorLogradouro = fiscalText(doc?.cliente_endereco, 120);
  if (!tomadorLogradouro) missing.push('logradouro do tomador');
  const tomadorNumero = fiscalText(doc?.cliente_numero, 20) || 'S/N';
  const tomadorBairro = fiscalText(doc?.cliente_bairro, 60);
  if (!tomadorBairro) missing.push('bairro do tomador');

  if (missing.length) {
    console.warn(`[NFSeBuilder] Campos obrigatórios do tomador ausentes: ${missing.join(', ')}. Enviando rascunho incompleto para aguardar retorno do Hub.`);
  }

  // ---------------------------------------------------------------------------
  // Validação do PRESTADOR (emitente)
  // ---------------------------------------------------------------------------
  const endRaw = (emitter.endereco || {}) as Record<string, any>;
  const prestadorMissing: string[] = [];
  if (!normalizeCpfCnpj(emitter.cnpj)) prestadorMissing.push('CNPJ do emitente');
  if (!fiscalText(emitter.razao_social, 150)) prestadorMissing.push('razão social do emitente');
  if (!emitter.im) prestadorMissing.push('inscrição municipal do emitente');
  const prestadorCityCode =
    normalizeIbgeCity(emitter.city_code) ||
    normalizeIbgeCity(endRaw.city_code) ||
    normalizeIbgeCity(endRaw.codigo_ibge);
  if (!prestadorCityCode) prestadorMissing.push('código IBGE do município do emitente');
  const prestadorCep = normalizeCep(endRaw.cep);
  if (!prestadorCep) prestadorMissing.push('CEP do emitente (8 dígitos válidos)');
  const prestadorUf = normalizeUf(endRaw.uf || endRaw.estado);
  if (!prestadorUf) prestadorMissing.push('UF do emitente');
  if (!fiscalText(endRaw.logradouro || endRaw.endereco, 120)) prestadorMissing.push('logradouro do emitente');
  if (!fiscalText(endRaw.bairro, 60)) prestadorMissing.push('bairro do emitente');
  if (prestadorMissing.length) {
    console.warn(`[NFSeBuilder] Campos obrigatórios do emitente ausentes: ${prestadorMissing.join(', ')}.`);
  }

  if (!doc?.rps_number) {
    console.warn('[NFSeBuilder] RPS sem número informado.');
  }
  if (!doc?.issue_date) {
    console.warn('[NFSeBuilder] Data de emissão não informada.');
  }
  if (!doc?.cod_servico) {
    console.warn('[NFSeBuilder] Código do serviço (item da lista LC 116, ex. 11.04) não informado. Enviando sem para aguardar retorno do Hub.');
  }
  if (money(doc?.valor_servicos) <= 0) {
    console.warn('[NFSeBuilder] Valor dos serviços deve ser maior que zero. Enviando rascunho incompleto.');
  }

  const integrationId = attempt > 0 ? `${doc.id}-r${attempt}` : String(doc.id);

  const emitterCnpj = onlyDigits(emitter.cnpj);
  const env: 'sandbox' | 'production' =
    environment || (emitter as any)?.metadata?.environment || 'production';

  const end = endRaw;
  const totalServicos = money(doc.valor_servicos);
  const baseCalculo = money(doc.base_calculo || totalServicos);
  const aliquota = num(doc.aliquota_iss);
  const valorIss = money(doc.valor_iss || (baseCalculo * aliquota) / 100);

  const items = Array.isArray(doc.items) ? doc.items : [];
  const baseDiscriminacao = String(
    doc.description ||
      items.map((it: any) => `${it.description} (${num(it.quantity)}x R$ ${num(it.unit_value).toFixed(2)})`).join(' | ') ||
      'Serviço de transporte'
  );

  // Seguro da carga: mesmos campos do CT-e. O padrão ABRASF não tem bloco
  // próprio, então garantimos a impressão na discriminação + observação.
  const insurance = {
    seguradora: doc.insurer_name || doc.seguradora || null,
    cnpjSeguradora: cnpjDigits(doc.insurer_cnpj || doc.cnpjSeguradora),
    apolice: doc.insurer_policy || doc.apolice || null,
    averbacao: doc.insurer_endorsement || doc.averbacao || null,
    valorSegurado: num(doc.insured_amount || doc.valorSegurado),
    valorSeguro: num(doc.insurance_premium || doc.valorSeguro),
  };
  const hasInsurance = hasInsuranceData(insurance);
  if (hasInsurance) {
    const check = validateInsurance({
      name: insurance.seguradora,
      cnpj: insurance.cnpjSeguradora,
      policy: insurance.apolice,
      endorsement: insurance.averbacao,
    });
    if (!check.ok) {
      console.warn(`[NFSeBuilder] Dados do seguro inválidos: ${check.messages.join(' ')}. Enviando mesmo assim.`);
    }
  }
  const insuranceText = buildInsuranceText({
    insurer_name: insurance.seguradora,
    insurer_cnpj: insurance.cnpjSeguradora,
    insurer_policy: insurance.apolice,
    insurer_endorsement: insurance.averbacao,
    insured_amount: insurance.valorSegurado,
    insurance_premium: insurance.valorSeguro,
  });

  const discriminacao = [baseDiscriminacao, insuranceText]
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);
  const observacao = [doc.notes || '', insuranceText].filter(Boolean).join(' — ').slice(0, 2000) || undefined;

  const payload = nonEmpty({
    // Identificação do RPS
    idIntegracao: integrationId,
    tipo: (doc.doc_type || 'RPS').toUpperCase(),
    natureza: doc.nat_operacao || '1', // 1 = Tributação no município
    regimeEspecialTributacao: doc.regime_tributario === '1' ? 1 : undefined, // 1 = Microempresa Municipal (Simples)
    optanteSimplesNacional: doc.regime_tributario === '1',
    regimeApuracaoSN: doc.regime_tributario === '1' ? 1 : undefined, // 1 = Faturamento (Competência)
    ambiente: env === 'sandbox' ? 'homologacao' : 'producao',

    prestador: {
      cpfCnpj: emitterCnpj,
      inscricaoMunicipal: onlyDigits(emitter.im) || fiscalText(emitter.im, 20) || undefined,
      inscricaoEstadual: sanitizeIe(emitter.ie) || undefined,
      razaoSocial: fiscalText(emitter.razao_social, 150) || undefined,
      nomeFantasia: fiscalText(emitter.nome_fantasia, 60) || undefined,
      telefone: normalizePhone((emitter as any).telefone || (emitter as any).phone) || undefined,
      email: isValidEmail((emitter as any).email) ? String((emitter as any).email).trim() : undefined,
      endereco: {
        logradouro: fiscalText(end.logradouro || end.endereco, 120) || undefined,
        numero: fiscalText(end.numero, 20) || 'S/N',
        complemento: fiscalText(end.complemento, 60) || undefined,
        bairro: fiscalText(end.bairro, 60) || undefined,
        codigoCidade: prestadorCityCode,
        descricaoCidade: normalizeCityName(end.municipio || end.cidade) || undefined,
        estado: prestadorUf,
        UF: prestadorUf,
        cep: prestadorCep,
        CEP: prestadorCep,
      },
    },

    tomador: {
      cpfCnpj: tomadorDoc,
      tipoPessoa: tomadorDoc && tomadorDoc.length === 11 ? 'F' : 'J',
      razaoSocial: tomadorNome,
      inscricaoMunicipal: onlyDigits(doc.cliente_im) || undefined,
      inscricaoEstadual: sanitizeIe(doc.cliente_ie) || undefined,
      email: isValidEmail(doc.cliente_email) ? String(doc.cliente_email).trim() : undefined,
      telefone: normalizePhone(doc.cliente_telefone) || undefined,
      endereco: {
        logradouro: tomadorLogradouro,
        numero: tomadorNumero,
        complemento: fiscalText(doc.cliente_complemento, 60) || undefined,
        bairro: tomadorBairro,
        codigoCidade: tomadorCityCode,
        descricaoCidade: tomadorCityName,
        estado: tomadorUf,
        cep: tomadorCep,
        codigoPais: 1058,
        descricaoPais: 'BRASIL',
        // Campos canônicos para provedores que exigem xLgr/nro/xBairro/UF/CEP
        xLgr: tomadorLogradouro,
        nro: tomadorNumero,
        xBairro: tomadorBairro,
        cMun: tomadorCityCode,
        xMun: tomadorCityName,
        UF: tomadorUf,
        CEP: tomadorCep,
      },
    },

    servico: {
      itemListaServico: doc.cod_servico || undefined, // Campo ABRASF (Ex: 07.02)
      codigoTributacaoMunicipio: doc.cod_trib_municipal || doc.cod_servico || undefined,
      codigoLocalPrestacao: normalizeIbgeCity(doc.cod_municipio_prestacao) || prestadorCityCode,
      codigoMunicipioIncidencia: normalizeIbgeCity(doc.cod_municipio_prestacao) || prestadorCityCode,
      codigoCnae: onlyDigits(doc.cnae) || undefined,
      codigoServico: doc.cod_servico || undefined,
      discriminacao,
      issRetido: !!doc.iss_retido,
      exigibilidade: doc.exigibilidade_iss || 1, // 1 = exigível (default)
      valor: {
        servico: totalServicos,
        deducoes: money(doc.valor_deducoes),
        baseCalculo,
        aliquota,
        iss: valorIss,
        pis: money(doc.valor_pis),
        cofins: money(doc.valor_cofins),
        inss: money(doc.valor_inss),
        ir: money(doc.valor_ir),
        csll: money(doc.valor_csll),
        outrasRetencoes: money(doc.outras_retencoes),
        issRetido: doc.iss_retido ? valorIss : 0,
        liquido: money(
          totalServicos -
            (doc.iss_retido ? valorIss : 0) -
            num(doc.valor_pis) - num(doc.valor_cofins) - num(doc.valor_inss) -
            num(doc.valor_ir) - num(doc.valor_csll) - num(doc.outras_retencoes),
        ),
        descontoIncondicionado: 0,
        descontoCondicionado: 0,
      },
      itens: items
        .filter((it: any) => fiscalText(it?.description, 120))
        .map((it: any) => ({
          descricao: fiscalText(it.description, 120),
          quantidade: num(it.quantity) || 1,
          valorUnitario: money(it.unit_value),
          valorTotal: money(it.total || num(it.quantity) * num(it.unit_value)),
        })),
    },

    rps: {
      numero: onlyDigits(doc.rps_number) || String(doc.rps_number),
      serie: String(doc.series || '1'),
      tipo: 'RPS',
      status: 'Normal',
      dataEmissao: doc.issue_date,
      competencia: String(doc.issue_date).slice(0, 10),
    },

    pedido: fiscalText(doc.pedido || doc.reference_number, 60) || undefined,
    observacao,

    // Bloco extra de seguro — enviado ao Hub para auditoria/impressão quando
    // o provedor municipal suportar campos adicionais.
    seguro: hasInsurance ? insurance : undefined,
    seguradora: hasInsurance ? insurance : undefined,
    seguros: hasInsurance ? [insurance] : undefined,
  });

  return {
    emitterCnpj,
    environment: env,
    externalId: integrationId,
    callbackUrl,
    payload,
  };
}