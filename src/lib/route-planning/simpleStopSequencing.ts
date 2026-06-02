import type { RouteStopDraft } from './routePlanningTypes';

const coll = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

/**
 * Ordem inteligente simples (sem mapa / sem distância real):
 * 1. Janela mais cedo
 * 2. Prioridade desc
 * 3. Cidade -> bairro -> destinatário
 * Quem não tem janela vai depois de quem tem, exceto priority >= 2.
 */
export function applySmartSequence(stops: RouteStopDraft[]): RouteStopDraft[] {
  const sorted = [...stops].sort((a, b) => {
    const aHigh = (a.priority || 0) >= 2;
    const bHigh = (b.priority || 0) >= 2;
    const aHasW = !!a.delivery_window_start;
    const bHasW = !!b.delivery_window_start;

    if (aHasW !== bHasW && !aHigh && !bHigh) return aHasW ? -1 : 1;
    if (aHasW && bHasW) {
      const cmp = (a.delivery_window_start || '').localeCompare(b.delivery_window_start || '');
      if (cmp !== 0) return cmp;
    }
    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);

    const c = coll.compare(a.city || '', b.city || '');
    if (c !== 0) return c;
    const n = coll.compare(a.neighborhood || '', b.neighborhood || '');
    if (n !== 0) return n;
    return coll.compare(a.recipient_name || '', b.recipient_name || '');
  });
  return sorted.map((s, i) => ({ ...s, optimized_order: i + 1, manual_order: i + 1 }));
}

export function applyOriginalOrder(stops: RouteStopDraft[]): RouteStopDraft[] {
  return [...stops]
    .sort((a, b) => (a.original_order || 0) - (b.original_order || 0))
    .map((s, i) => ({ ...s, manual_order: i + 1 }));
}

/**
 * Sequenciamento automático mais forte (sem distância real).
 * Ordem de preferência:
 *  1. Janela mais restritiva primeiro (fim mais cedo)
 *  2. Risco crítico antes de warning antes de normal
 *  3. Prioridade desc
 *  4. Cidade -> bairro -> destinatário
 * Mantém estrutura aberta para receber coordenadas no futuro.
 */
export function autoSequenceStops(stops: RouteStopDraft[]): RouteStopDraft[] {
  const riskWeight = (l?: string) => l === 'critical' ? 0 : l === 'warning' ? 1 : 2;
  const sorted = [...stops].sort((a, b) => {
    const aEnd = a.delivery_window_end || '';
    const bEnd = b.delivery_window_end || '';
    if (aEnd && bEnd && aEnd !== bEnd) return aEnd.localeCompare(bEnd);
    if (!!aEnd !== !!bEnd) return aEnd ? -1 : 1;

    const aStart = a.delivery_window_start || '';
    const bStart = b.delivery_window_start || '';
    if (aStart && bStart && aStart !== bStart) return aStart.localeCompare(bStart);

    const rw = riskWeight(a.risk_level) - riskWeight(b.risk_level);
    if (rw !== 0) return rw;

    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);

    const c = coll.compare(a.city || '', b.city || '');
    if (c !== 0) return c;
    const n = coll.compare(a.neighborhood || '', b.neighborhood || '');
    if (n !== 0) return n;
    return coll.compare(a.recipient_name || '', b.recipient_name || '');
  });
  return sorted.map((s, i) => ({ ...s, optimized_order: i + 1, manual_order: i + 1 }));
}
