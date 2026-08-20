import { describe, it, expect } from 'vitest';
import { supabase } from '@/integrations/supabase/client';

describe('Security Layer Hardening', () => {
  const FAKE_TENANT_ID = '00000000-0000-0000-0000-000000000000';

  it('should block cross-tenant audit access', async () => {
    const { data, error } = await supabase.rpc('audit_data_consistency_v4', {
      p_tenant_id: FAKE_TENANT_ID
    });
    // Should fail because user is not a member of FAKE_TENANT_ID
    expect(error).toBeDefined();
    expect(error?.message).toContain('forbidden');
  });

  it('should block unauthorized repair execution', async () => {
    const { error } = await supabase.rpc('execute_data_repair_v1', {
      p_tenant_id: FAKE_TENANT_ID,
      p_batch_id: FAKE_TENANT_ID
    });
    expect(error).toBeDefined();
    expect(error?.message).toMatch(/forbidden|Apenas administradores/);
  });

  it('should block cross-tenant driver workspace access', async () => {
    const { error } = await supabase.rpc('get_driver_workspace_v1', {
      p_driver_id: FAKE_TENANT_ID,
      p_tenant_id: FAKE_TENANT_ID
    });
    expect(error).toBeDefined();
    expect(error?.message).toContain('negado');
  });

  it('should block cross-tenant financial summary', async () => {
    const { error } = await supabase.rpc('get_operational_financial_summary_v1', {
      _tenant_id: FAKE_TENANT_ID
    });
    expect(error).toBeDefined();
    expect(error?.message).toContain('forbidden');
  });
});
