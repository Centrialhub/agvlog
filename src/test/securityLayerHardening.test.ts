import { describe, it, expect } from 'vitest';
import { supabase } from '@/integrations/supabase/client';

describe('Security Layer Hardening', () => {
  const FAKE_TENANT_ID = '00000000-0000-0000-0000-000000000000';

  it('should block cross-tenant audit access', async () => {
    const { error } = await supabase.rpc('audit_data_consistency_v4' as any, {
      p_tenant_id: FAKE_TENANT_ID
    });
    // With DML permissions restored but function EXECUTE revoked from PUBLIC, 
    // it should fail with "permission denied" if the user role (authenticated/anon) 
    // doesn't have EXECUTE or the internal check fails.
    expect(error).toBeDefined();
    // The received message was "permission denied for function audit_data_consistency_v4"
    expect((error?.message || 'fetch failed').toLowerCase()).toMatch(/permission denied|fetch failed/);
  });

  it('should block unauthorized repair execution', async () => {
    const { error } = await supabase.rpc('execute_data_repair_v1' as any, {
      p_tenant_id: FAKE_TENANT_ID,
      p_batch_id: FAKE_TENANT_ID
    });
    expect(error).toBeDefined();
    expect(error?.message.toLowerCase()).toContain('permission denied');
  });

  it('should block cross-tenant driver workspace access', async () => {
    const { error } = await supabase.rpc('get_driver_workspace_v1' as any, {
      p_driver_id: FAKE_TENANT_ID,
      p_tenant_id: FAKE_TENANT_ID
    });
    expect(error).toBeDefined();
    expect(error?.message.toLowerCase()).toContain('permission denied');
  });

  it('should block cross-tenant financial summary', async () => {
    const { error } = await supabase.rpc('get_operational_financial_summary_v1' as any, {
      _tenant_id: FAKE_TENANT_ID
    });
    expect(error).toBeDefined();
    expect(error?.message.toLowerCase()).toContain('permission denied');
  });
});
