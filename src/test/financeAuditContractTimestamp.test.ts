import { describe, expect, it } from 'vitest';
import { financeAuditSchema } from '@/lib/financial/financeAuditContract';

describe('finance audit response contract', () => {
  it('accepts the PostgreSQL timestamp format returned in production', () => {
    expect(() => financeAuditSchema.parse({
      version: 1,
      tenant_id: '6e874e6e-5bca-486d-9928-bef0646989c4',
      page: 1,
      page_size: 30,
      total: 0,
      manual_count: 0,
      timezone: 'America/Sao_Paulo',
      snapshot_at: '2026-09-21T16:48:57.907766+00:00',
      rows: [],
    })).not.toThrow();
  });
});
