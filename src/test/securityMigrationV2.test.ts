import { describe, it, expect } from 'vitest';
import { supabase } from '@/integrations/supabase/client';

/**
 * SECURITY REGRESSION TEST SUITE
 * 
 * Verifies that the forward-only migration applied:
 * 1. Revoked excess EXECUTE permissions.
 * 2. Neutralized specific mass-grant migrations.
 * 3. Enforced membership checks on SECURITY DEFINER functions.
 * 4. Disabled unstable modules (repair/plan_start).
 */
describe('Security Migration v20260820233000', () => {
  const FAKE_TENANT_ID = '00000000-0000-0000-0000-000000000000';

  it('should block execute_data_repair_v1 with FEATURE_DISABLED', async () => {
    const { error } = await supabase.rpc('execute_data_repair_v1' as any, {
      p_tenant_id: FAKE_TENANT_ID,
      p_batch_id: FAKE_TENANT_ID
    });
    // Should be permission denied OR Feature Disabled depending on role
    expect(error).toBeDefined();
    const msg = error?.message.toLowerCase() || '';
    expect(msg.includes('permission denied') || msg.includes('feature_disabled')).toBe(true);
  });

  it('should block plan_dispatch_start_trip_v1 (unstable version)', async () => {
    const { error } = await supabase.rpc('plan_dispatch_start_trip_v1' as any, {
      p_tenant_id: FAKE_TENANT_ID,
      p_driver_id: FAKE_TENANT_ID,
      p_vehicle_id: FAKE_TENANT_ID,
      p_load_ids: [],
      p_stops: []
    });
    expect(error).toBeDefined();
    expect(error?.message.toLowerCase()).toContain('permission denied');
  });

  it('should fail with membership error on cross-tenant call to valid RPC', async () => {
    // get_driver_workspace_v1 is authorized for 'authenticated' but should fail membership check
    const { error } = await supabase.rpc('get_driver_workspace_v1' as any, {
      p_driver_id: FAKE_TENANT_ID,
      p_tenant_id: FAKE_TENANT_ID
    });
    expect(error).toBeDefined();
    // Message should be "Acesso negado" from check_tenant_membership or permission denied
    const msg = error?.message.toLowerCase() || '';
    expect(msg.includes('negado') || msg.includes('denied')).toBe(true);
  });
});
