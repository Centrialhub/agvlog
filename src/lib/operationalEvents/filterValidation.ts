export interface OperationalEventFilterDraft {
  search: string;
  dateFrom?: Date;
  dateTo?: Date;
  impactMin: string;
  impactMax: string;
}

export function validateOperationalEventFilterDraft(filters: OperationalEventFilterDraft): string | null {
  if (filters.search.trim().length > 200) return 'A busca deve ter no máximo 200 caracteres.';
  if (filters.dateFrom && filters.dateTo && filters.dateFrom.getTime() > filters.dateTo.getTime()) {
    return 'A data inicial não pode ser posterior à data final.';
  }
  const minimum = filters.impactMin === '' ? null : Number(filters.impactMin);
  const maximum = filters.impactMax === '' ? null : Number(filters.impactMax);
  if (minimum !== null && (!Number.isFinite(minimum) || minimum < 0)) return 'O impacto mínimo deve ser um valor maior ou igual a zero.';
  if (maximum !== null && (!Number.isFinite(maximum) || maximum < 0)) return 'O impacto máximo deve ser um valor maior ou igual a zero.';
  if (minimum !== null && maximum !== null && minimum > maximum) return 'O impacto mínimo não pode ser maior que o máximo.';
  return null;
}
