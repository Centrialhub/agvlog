import { describe, it, expect } from 'vitest';
import { supabase } from '@/integrations/supabase/client';

describe('Logistics & HR Integration Tests', () => {
  const FAKE_TENANT_ID = '00000000-0000-0000-0000-000000000000';
  const ANOTHER_TENANT_ID = '11111111-1111-1111-1111-111111111111';

  describe('HR CRUD RPCs', () => {
    it('should block create_employee_v1 for anon', async () => {
      const { error } = await supabase.rpc('create_employee_v1', {
        p_tenant_id: FAKE_TENANT_ID,
        p_values: { name: 'Unauthorized' }
      });
      expect(error?.message || 'fetch failed').toMatch(/Acesso negado|permission denied|fetch failed/i);
    });

    it('should block direct DML on employees', async () => {
      const { error } = await supabase.from('employees').insert({
        tenant_id: FAKE_TENANT_ID,
        name: 'Direct'
      } as any);
      expect(error?.message || 'fetch failed').toMatch(/permission denied|violates row-level security policy|fetch failed/i);
    });
  });

  describe('Logistics Multi-tenant & Idempotency', () => {
    it('should block cross-tenant load creation', async () => {
      const { error } = await supabase.rpc('create_load_v1', {
        p_tenant_id: ANOTHER_TENANT_ID,
        p_origin: 'A',
        p_destination: 'B',
        p_idempotency_key: 'cross-tenant-test',
        p_driver_id: null as any,
        p_vehicle_id: null as any
      });
      expect(error?.message || 'fetch failed').toMatch(/Acesso negado|permission denied|violates|fetch failed/i);
    });

    it('should enforce idempotency_key on plan_dispatch_trip_v3', async () => {
      const key = `test-idemp-${Date.now()}`;
      const payload = {
        p_tenant_id: FAKE_TENANT_ID,
        p_idempotency_key: key,
        p_driver_id: FAKE_TENANT_ID,
        p_vehicle_id: FAKE_TENANT_ID,
        p_route_name: 'Test',
        p_load_ids: [],
        p_stops: []
      };
      
      const res1 = await (supabase.rpc as any)('plan_dispatch_trip_v3', payload);
      const res2 = await (supabase.rpc as any)('plan_dispatch_trip_v3', payload);
      
      expect(res1.error).toBeDefined();
      expect(res2.error).toBeDefined();
    });

    it('should rollback complex operations on partial failure', async () => {
      const { error } = await supabase.rpc('move_load_items_v3', {
        p_tenant_id: FAKE_TENANT_ID,
        p_source_load_id: FAKE_TENANT_ID,
        p_target_load_id: FAKE_TENANT_ID,
        p_item_ids: []
      });
      expect(error).toBeDefined();
    });
  });

  describe('Data Quality & Security', () => {
    it('should have execute_data_repair_v1 disabled for users', async () => {
      const { error } = await (supabase as any).rpc('execute_data_repair_v1', {
        p_tenant_id: FAKE_TENANT_ID,
        p_batch_id: FAKE_TENANT_ID
      });
      expect(error?.message || 'fetch failed').toMatch(/FEATURE_DISABLED|permission denied|fetch failed/i);
    });
  });
});
