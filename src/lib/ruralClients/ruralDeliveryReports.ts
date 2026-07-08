import type { RuralProfile } from '@/hooks/useRuralClients';

const csvEscape = (v: unknown): string => {
  if (v == null) return '';
  const s = String(v).replace(/"/g, '""');
  return /[";\n]/.test(s) ? `"${s}"` : s;
};

export function ruralProfilesToCsv(rows: RuralProfile[]): string {
  const header = [
    'Cliente', 'Cidade', 'UF', 'Bairro/Localidade', 'Fornecedor Relacionado',
    'Tipo Acesso', 'KM ida/volta', 'Modo Entrega',
    'Ligar Antes', 'Contato', 'Telefone',
    'Táxi Obrigatório', 'Contato Táxi', 'Valor Táxi Estimado',
    'Instrução Motorista', 'Observação Interna',
  ];
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push([
      r.client_name || '',
      r.city || '', r.state || '', r.neighborhood || r.locality || '',
      r.related_remitter_name || '',
      accessTypeLabel(r.access_type),
      r.round_trip_km ?? '',
      deliveryModeLabel(r.delivery_mode),
      r.requires_contact_before_delivery ? 'Sim' : 'Não',
      r.contact_name || '', r.contact_phone || '',
      r.taxi_required ? 'Sim' : 'Não',
      r.taxi_contact_phone || '',
      r.taxi_estimated_cost != null ? String(r.taxi_estimated_cost).replace('.', ',') : '',
      r.driver_instructions || '',
      r.internal_notes || '',
    ].map(csvEscape).join(';'));
  }
  return '\uFEFF' + lines.join('\r\n');
}

export function accessTypeLabel(v?: string | null): string {
  switch (v) {
    case 'paved': return 'Asfalto';
    case 'dirt_road': return 'Estrada de terra';
    case 'mixed': return 'Misto';
    case 'unknown': return 'Desconhecido';
    default: return v || '';
  }
}

export function deliveryModeLabel(v?: string | null): string {
  switch (v) {
    case 'direct': return 'Direto';
    case 'city_pickup': return 'Retirada na cidade';
    case 'taxi': return 'Táxi/terceiro';
    case 'third_party': return 'Terceiro';
    case 'call_before': return 'Ligar antes';
    default: return v || '—';
  }
}

export function difficultyLabel(v?: string | null): string {
  switch (v) {
    case 'low': return 'Baixa';
    case 'medium': return 'Média';
    case 'high': return 'Alta';
    case 'critical': return 'Crítica';
    default: return v || '';
  }
}