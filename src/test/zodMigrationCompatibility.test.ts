import { describe, expect, it } from 'vitest';
import { cashForecastComparisonResultSchema } from '@/lib/financial/cashForecastComparisonContract';
import { statementIntakeResultSchema } from '@/lib/financial/statementImportContract';

const postgresId = '10000000-0000-0000-0000-000000000001';
const receipt = {
  version: 1, tenant_id: postgresId, request_id: postgresId, import_id: postgresId,
  counts: { new: 2 }, source_verification: 'pending', confirmed: true,
};

describe('Zod migration preserves existing database contracts', () => {
  it('accepts PostgreSQL UUIDs without requiring an RFC version or variant', () => {
    const result = cashForecastComparisonResultSchema.parse({
      version: 1, tenant_id: postgresId, actor_id: postgresId, snapshot_id: postgresId,
      source_revision: 'saved', content_hash: 'immutable', comparison: null,
      unavailable_reason: 'forecast_projection_unavailable',
    });
    expect(result.tenant_id).toBe(postgresId);
    expect(statementIntakeResultSchema.safeParse({ ...receipt, tenant_id: 'invalid-id' }).success).toBe(false);
  });

  it('preserves sparse intake counts without inventing missing categories', () => {
    expect(statementIntakeResultSchema.parse(receipt).counts).toEqual({ new: 2 });
  });

  it.each([{ unknown_category: 2 }, { new: -1 }, { new: '2' }])('rejects invalid intake counts %j', counts => {
    expect(statementIntakeResultSchema.safeParse({ ...receipt, counts }).success).toBe(false);
  });
});
