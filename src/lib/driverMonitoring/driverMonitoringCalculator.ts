// Cálculos e regras de status para o Monitoramento de Motoristas

export type DriverMonitorStatus =
  | 'active'
  | 'on_time'
  | 'delayed'
  | 'no_update'
  | 'returning'
  | 'arrived'
  | 'completed'
  | 'waiting_load'
  | 'cancelled'
  | 'issue';

export interface ProgressUpdateLike {
  update_date: string;
  deliveries_completed_in_city?: number | null;
  observation?: string | null;
  status?: string | null;
  created_at?: string | null;
}

export interface MonitorLike {
  total_deliveries: number;
  completed_deliveries?: number | null;
  expected_return_date?: string | null;
  actual_returned_at?: string | null;
  status?: string | null;
  last_update_at?: string | null;
  remaining_cities?: any[] | null;
  current_city?: string | null;
  notes?: string | null;
}

export function calculateCompletedDeliveries(updates: ProgressUpdateLike[]): number {
  return updates.reduce((sum, u) => sum + Number(u.deliveries_completed_in_city || 0), 0);
}

export function calculateRemainingDeliveries(total: number, completed: number): number {
  return Math.max(0, Number(total || 0) - Number(completed || 0));
}

export function calculateProgressPercent(total: number, completed: number): number {
  const t = Number(total || 0);
  if (t <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(completed || 0) / t) * 100)));
}

export function calculateExpectedReturnDate(startedAt: Date | string | null, days: number | null): string | null {
  if (!startedAt || !days || days <= 0) return null;
  const d = typeof startedAt === 'string' ? new Date(startedAt) : startedAt;
  if (isNaN(d.getTime())) return null;
  const out = new Date(d);
  out.setDate(out.getDate() + Number(days));
  return out.toISOString().slice(0, 10);
}

export function detectDelayedRoute(monitor: MonitorLike, now: Date = new Date()): boolean {
  if (!monitor.expected_return_date) return false;
  if (monitor.actual_returned_at) return false;
  const remaining = calculateRemainingDeliveries(monitor.total_deliveries, monitor.completed_deliveries || 0);
  if (remaining <= 0) return false;
  const exp = new Date(monitor.expected_return_date + 'T23:59:59');
  return now.getTime() > exp.getTime();
}

export function calculateDriverStatus(
  monitor: MonitorLike,
  updates: ProgressUpdateLike[],
  now: Date = new Date(),
): DriverMonitorStatus {
  if (monitor.status === 'cancelled') return 'cancelled';
  if (monitor.actual_returned_at) return monitor.status === 'arrived' ? 'arrived' : 'completed';
  if (monitor.status === 'waiting_load') return 'waiting_load';

  const completed = calculateCompletedDeliveries(updates) || monitor.completed_deliveries || 0;
  const remaining = calculateRemainingDeliveries(monitor.total_deliveries, completed);

  if (remaining === 0 && monitor.total_deliveries > 0) return 'returning';

  const hasCritical = /crítico|critico|acidente|urgente|problema/i.test(monitor.notes || '');
  if (hasCritical) return 'issue';

  if (detectDelayedRoute({ ...monitor, completed_deliveries: completed }, now)) return 'delayed';

  const last = monitor.last_update_at ? new Date(monitor.last_update_at) : null;
  if (last && now.getTime() - last.getTime() > 24 * 3600 * 1000) return 'no_update';

  return 'on_time';
}

export function parseRemainingCities(text: string | null | undefined): string[] {
  if (!text) return [];
  return String(text)
    .split(/[\n;,\/•\-–]| e |\|/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && !/^\d+$/.test(s));
}

export function normalizePlannedRoute(text: string | null | undefined): { text: string; cities: string[] } {
  const raw = (text || '').replace(/^rota\s+planejada:?/i, '').trim();
  return { text: raw, cities: parseRemainingCities(raw) };
}

export function normalizeStatusLabel(label: string | null | undefined): DriverMonitorStatus | null {
  const s = (label || '').toLowerCase().trim();
  if (!s) return null;
  if (/atras/.test(s)) return 'delayed';
  if (/no\s*prazo|on\s*time/.test(s)) return 'on_time';
  if (/retorn/.test(s)) return 'returning';
  if (/finaliz|conclu|completo/.test(s)) return 'completed';
  if (/cheg/.test(s)) return 'arrived';
  if (/cancel/.test(s)) return 'cancelled';
  if (/aguard/.test(s)) return 'waiting_load';
  if (/sem\s*atualiz/.test(s)) return 'no_update';
  return null;
}

export const STATUS_LABELS: Record<DriverMonitorStatus, string> = {
  active: 'Ativo',
  on_time: 'No prazo',
  delayed: 'Atrasado',
  no_update: 'Sem atualização',
  returning: 'Retornando',
  arrived: 'Chegou',
  completed: 'Finalizado',
  waiting_load: 'Aguardando carga',
  cancelled: 'Cancelado',
  issue: 'Ocorrência',
};