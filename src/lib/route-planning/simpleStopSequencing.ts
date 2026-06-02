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
