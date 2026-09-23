export type OperationalEventPresetFilters = {
  search?: string;
  status?: string;
  type?: string;
  severity?: string;
  vehicleId?: string;
  driverId?: string;
  clientId?: string;
  loadId?: string;
  impactMin?: string;
  impactMax?: string;
  hasImpact?: boolean;
  responsibility?: string;
  dateFromISO?: string | null;
  dateToISO?: string | null;
  dateBasis?: 'created_at' | 'resolved_at';
};

export type OperationalEventPreset = {
  id: string;
  name: string;
  filters: OperationalEventPresetFilters;
  builtin?: boolean;
};

const optionalStringKeys: (keyof OperationalEventPresetFilters)[] = [
  'search', 'status', 'type', 'severity', 'vehicleId', 'driverId', 'clientId', 'loadId',
  'impactMin', 'impactMax', 'responsibility',
];

function isPreset(value: unknown): value is OperationalEventPreset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return false;
  if (!candidate.filters || typeof candidate.filters !== 'object' || Array.isArray(candidate.filters)) return false;
  const filters = candidate.filters as Record<string, unknown>;
  if (optionalStringKeys.some((key) => filters[key] !== undefined && typeof filters[key] !== 'string')) return false;
  if (filters.hasImpact !== undefined && typeof filters.hasImpact !== 'boolean') return false;
  if (filters.dateBasis !== undefined && filters.dateBasis !== 'created_at' && filters.dateBasis !== 'resolved_at') return false;
  return ['dateFromISO', 'dateToISO'].every((key) =>
    filters[key] === undefined || filters[key] === null || typeof filters[key] === 'string');
}

export function parseOperationalEventPresets(raw: string | null): OperationalEventPreset[] | null {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isPreset) ? parsed : null;
  } catch {
    return null;
  }
}

export function operationalEventPresetsKey(userId?: string, tenantId?: string): string | null {
  return userId && tenantId ? `opEvents.presets.v2.${userId}.${tenantId}` : null;
}

export function legacyOperationalEventPresetsKey(userId?: string): string | null {
  return userId ? `opEvents.presets.v1.${userId}` : null;
}

type PresetStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function loadOperationalEventPresets(
  storage: PresetStorage,
  userId?: string,
  tenantId?: string,
): { presets: OperationalEventPreset[]; migratedFromLegacy: boolean } {
  const currentKey = operationalEventPresetsKey(userId, tenantId);
  const legacyKey = legacyOperationalEventPresetsKey(userId);
  if (!currentKey || !legacyKey) return { presets: [], migratedFromLegacy: false };

  const currentRaw = storage.getItem(currentKey);
  if (currentRaw !== null) {
    const current = parseOperationalEventPresets(currentRaw);
    if (current === null) {
      storage.removeItem(currentKey);
      return { presets: [], migratedFromLegacy: false };
    }
    return { presets: current, migratedFromLegacy: false };
  }

  const legacyRaw = storage.getItem(legacyKey);
  const legacy = parseOperationalEventPresets(legacyRaw);
  if (legacy === null) {
    storage.removeItem(legacyKey);
    return { presets: [], migratedFromLegacy: false };
  }
  if (!legacy.length) return { presets: [], migratedFromLegacy: false };

  try {
    storage.setItem(currentKey, JSON.stringify(legacy));
    storage.removeItem(legacyKey);
  } catch {
    // Mantém a chave antiga e restaura os presets apenas em memória nesta sessão.
  }
  return { presets: legacy, migratedFromLegacy: true };
}
