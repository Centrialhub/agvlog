// Valid status transitions for loads and orders

export const LOAD_TRANSITIONS: Record<string, string[]> = {
  planned: ['assembling'],
  assembling: ['ready', 'planned'],
  ready: ['loading', 'assembling', 'in_transit'],
  loading: ['loaded', 'ready', 'in_transit'],
  loaded: ['in_transit'],
  in_transit: ['delivered', 'divergent', 'partial_delivery', 'returned', 'refused'],
  delivered: [],
  divergent: ['in_transit', 'delivered', 'partial_delivery', 'returned', 'refused'],
  partial_delivery: ['delivered', 'returned'],
  returned: ['delivered'],
  refused: ['returned', 'delivered'],
  failed: ['returned', 'delivered'],
};

export const ORDER_TRANSITIONS: Record<string, string[]> = {
  received: ['waiting_stock', 'picking', 'cancelled'],
  waiting_stock: ['picking', 'cancelled'],
  picking: ['ready_for_loading', 'waiting_stock'],
  ready_for_loading: ['loading'],
  loading: ['shipped'],
  shipped: ['delivered', 'partially_delivered'],
  delivered: [],
  partially_delivered: ['delivered'],
  cancelled: [],
};

export function getNextStatuses(currentStatus: string, type: 'load' | 'order'): string[] {
  const map = type === 'load' ? LOAD_TRANSITIONS : ORDER_TRANSITIONS;
  return map[currentStatus] || [];
}

export function canTransition(from: string, to: string, type: 'load' | 'order'): boolean {
  return getNextStatuses(from, type).includes(to);
}
