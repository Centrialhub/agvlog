// Modelos de ocorrência para texto padronizado enviado ao fornecedor.
// Cada tipo declara campos estruturados que o motorista preenche
// e um formatador que monta o bloco de texto final (copy/paste).

export type FieldType = 'text' | 'textarea' | 'select' | 'date';

export interface OccurrenceField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];          // para select
  placeholder?: string;
  helper?: string;
}

export interface OccurrenceTemplate {
  /** Título do bloco (cabeçalho do texto) */
  title: string;
  /** Campos a coletar do motorista */
  fields: OccurrenceField[];
  /** Texto fixo (OBS/DESCRIÇÃO) que aparece no final */
  footer?: { obs?: string; description?: string };
  /** Inclui o seletor de "Solução" padrão */
  includeSolution?: boolean;
}

const SOLUTION_OPTIONS = ['Desconto no boleto', 'Nota de devolução', 'Reposição'];

const COMMON: OccurrenceField[] = [
  { key: 'nota', label: 'Nota', type: 'text', required: true, placeholder: 'Nº da NF' },
  { key: 'razao_social', label: 'Razão Social', type: 'text', required: true },
  { key: 'cidade', label: 'Cidade', type: 'text', required: true },
];

export const OCCURRENCE_TEMPLATES: Record<string, OccurrenceTemplate> = {
  missing_goods_fractional: {
    title: 'FALTA DE MERCADORIA – FRACIONADO',
    fields: [
      ...COMMON,
      { key: 'item', label: 'Item (cód + descrição + QTD)', type: 'textarea', required: true, placeholder: 'Ex.: 12345 - Sabonete Lux 90g - QTD 3' },
    ],
    footer: { obs: 'Falta identificada no fracionado. Ao abrir a caixa, foi constatada a ausência do(s) item(ns).' },
    includeSolution: true,
  },
  missing_goods: {
    title: 'FALTA DE MERCADORIA',
    fields: [
      ...COMMON,
      { key: 'item', label: 'Item (cód + descrição + QTD)', type: 'textarea', required: true },
    ],
    footer: { obs: 'Falta de (caixa ou fardo) fechada. Mercadoria pertencente a palete que não foi manipulado no depósito.' },
    includeSolution: true,
  },
  near_expiration: {
    title: 'PRODUTO PRÓXIMO DO VENCIMENTO',
    fields: [
      ...COMMON,
      { key: 'item', label: 'Item (cód + descrição + QTD)', type: 'textarea', required: true },
      { key: 'validade', label: 'Validade do item', type: 'date', required: true },
    ],
    footer: { description: 'Cliente não irá permanecer com a mercadoria devido à proximidade da validade.' },
    includeSolution: true,
  },
  expired_goods: {
    title: 'PRODUTO VENCIDO',
    fields: [
      ...COMMON,
      { key: 'item', label: 'Item (cód + descrição + QTD)', type: 'textarea', required: true },
      { key: 'validade', label: 'Validade do item', type: 'date' },
    ],
    footer: { description: 'Mercadoria com validade expirada. Cliente não recebeu o item.' },
    includeSolution: true,
  },
  boleto_extension: {
    title: 'PRORROGAÇÃO DE BOLETO',
    fields: [...COMMON],
    footer: { description: 'Cliente solicita prorrogação do boleto.' },
  },
  no_order: {
    title: 'CLIENTE NÃO FEZ O PEDIDO',
    fields: [
      ...COMMON,
      { key: 'item', label: 'Item (cód + descrição + QTD)', type: 'textarea', required: true },
    ],
    footer: { description: 'Cliente está devolvendo a mercadoria, pois informa que não realizou o pedido.' },
  },
  client_refused: {
    title: 'CLIENTE FECHADO',
    fields: [...COMMON],
    footer: { description: 'Cliente fechado no momento da entrega.', obs: 'Segue imagem do local (evidência).' },
  },
  delivery_delay: {
    title: 'ATRASO NA ENTREGA',
    fields: [
      { key: 'cidade', label: 'Cidade', type: 'text', required: true },
    ],
    footer: {
      description:
        'Devido ao baixo volume de vendas na cidade, não será possível realizar as entregas nesta semana, pois não atingimos o valor mínimo necessário para viabilizar o atendimento. Dessa forma, iremos aguardar o aumento do volume para programar a entrega.\n\nPedimos, por gentileza, atenção aos boletos, a fim de evitar qualquer tipo de protesto.\n\nAtenciosamente.',
    },
  },
  wrong_product: {
    title: 'MERCADORIA INVERTIDA',
    fields: [
      ...COMMON,
      { key: 'era_pra_ter_ido', label: 'Era pra ter ido', type: 'textarea', required: true },
      { key: 'foi_enviado', label: 'Foi enviado', type: 'textarea', required: true },
    ],
    footer: { description: 'Divergência no envio da mercadoria. Produto enviado diferente do que constava no pedido.' },
    includeSolution: true,
  },
};

export const SOLUTION_FIELD: OccurrenceField = {
  key: 'solucao',
  label: 'Solução',
  type: 'select',
  options: SOLUTION_OPTIONS,
  required: true,
};

/** Retorna a lista efetiva de campos (inclui Solução quando aplicável). */
export function getTemplateFields(eventType: string): OccurrenceField[] {
  const tpl = OCCURRENCE_TEMPLATES[eventType];
  if (!tpl) return [];
  return tpl.includeSolution ? [...tpl.fields, SOLUTION_FIELD] : tpl.fields;
}

/** Gera o texto padronizado pronto para copiar e enviar ao fornecedor. */
export function formatOccurrenceReport(eventType: string, details: Record<string, unknown> | null | undefined): string | null {
  const tpl = OCCURRENCE_TEMPLATES[eventType];
  if (!tpl) return null;
  const d = details || {};
  const lines: string[] = [];
  lines.push(tpl.title);
  lines.push('');
  for (const f of tpl.fields) {
    const v = d[f.key];
    if (v === undefined || v === null || v === '') continue;
    let display = String(v);
    if (f.type === 'date') {
      try { display = new Date(String(v)).toLocaleDateString('pt-BR'); } catch { /* keep */ }
    }
    lines.push(`${f.label}: ${display}`);
  }
  if (tpl.footer?.obs) {
    lines.push('');
    lines.push(`OBS: ${tpl.footer.obs}`);
  }
  if (tpl.footer?.description) {
    lines.push('');
    lines.push(`DESCRIÇÃO: ${tpl.footer.description}`);
  }
  if (tpl.includeSolution && d.solucao) {
    lines.push('');
    lines.push(`SOLUÇÃO: ${d.solucao}`);
  } else if (tpl.includeSolution) {
    lines.push('');
    lines.push('SOLUÇÃO: Desconto no boleto / Nota de devolução / Reposição');
  }
  return lines.join('\n');
}
