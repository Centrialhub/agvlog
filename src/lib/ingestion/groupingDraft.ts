export interface GroupingAssignment {
  vehicleId: string | null;
  driverId: string | null;
}

export const groupingDraftKey = (tenantId: string, actorId: string) =>
  `ingestion_grouping_state:${tenantId}:${actorId}`;

export function restoreGroupingAssignments(
  raw: string,
  expectedSnapshot: unknown,
  suggestionCount: number,
  validVehicleIds: ReadonlySet<string>,
  validDriverIds: ReadonlySet<string>,
  now = Date.now(),
): Map<number, GroupingAssignment> | null {
  const parsed = JSON.parse(raw) as { ts?: unknown; assignments?: unknown; suggestionsSnapshot?: unknown };
  if (typeof parsed.ts !== 'number' || now - parsed.ts > 4 * 60 * 60 * 1000 || now < parsed.ts) return null;
  if (JSON.stringify(parsed.suggestionsSnapshot) !== JSON.stringify(expectedSnapshot)) return null;
  if (!Array.isArray(parsed.assignments)) return null;
  const restored = new Map<number, GroupingAssignment>();
  for (const entry of parsed.assignments) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [index, value] = entry;
    if (!Number.isInteger(index) || index < 0 || index >= suggestionCount || !value || typeof value !== 'object') return null;
    const assignment = value as Partial<GroupingAssignment>;
    if (assignment.vehicleId !== null && (typeof assignment.vehicleId !== 'string' || !validVehicleIds.has(assignment.vehicleId))) return null;
    if (assignment.driverId !== null && (typeof assignment.driverId !== 'string' || !validDriverIds.has(assignment.driverId))) return null;
    restored.set(index, { vehicleId: assignment.vehicleId, driverId: assignment.driverId });
  }
  return restored.size ? restored : null;
}
