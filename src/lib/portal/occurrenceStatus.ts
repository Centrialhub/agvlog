export interface ResolvableOccurrence {
  public_status?: string | null;
  resolved_at?: string | null;
}

const CLOSED_PUBLIC_STATUSES = new Set(['resolved', 'closed', 'cancelled']);

export function isOpenPortalOccurrence(occurrence: ResolvableOccurrence): boolean {
  return occurrence.resolved_at == null
    && !CLOSED_PUBLIC_STATUSES.has((occurrence.public_status || 'open').toLowerCase());
}
