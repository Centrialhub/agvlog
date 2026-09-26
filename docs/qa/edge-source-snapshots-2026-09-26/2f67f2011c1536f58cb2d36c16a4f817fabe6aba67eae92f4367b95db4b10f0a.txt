type Unit = { external_code: unknown; metadata?: Record<string, unknown> | null };
const nonblank = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
export function governanceUnitIdentity(unit: Unit) {
  const metadata = unit.metadata || {};
  // PositionHistory can create an internal key from a label; that is not an SSX integration code.
  const code = nonblank(metadata.tracked_unit_integration_code);
  const identification = nonblank(metadata.tracked_unit);
  return { scope: String(unit.external_code || '').trim(), code,
    filter: code ? { PropertyName: 'TrackedUnitIntegrationCode', Condition: 'Equal', Value: code }
      : identification ? { PropertyName: 'TrackedUnitIdentification', Condition: 'Equal', Value: identification } : null };
}
