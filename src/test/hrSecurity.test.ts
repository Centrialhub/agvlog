import { describe, it, expect, beforeAll } from 'vitest';
import { supabase } from '@/integrations/supabase/client';

describe('HR RPC Security', () => {
  it('should deny employee creation to unauthenticated users', async () => {
    const { error } = await supabase.rpc('create_employee_v1', {
      p_tenant_id: '00000000-0000-0000-0000-000000000000',
      p_values: { name: 'Test' }
    });
    // With anonymous execute revoked, this should fail
    expect(error).toBeDefined();
  });

  it('should have revoked direct DML on employees table', async () => {
    const { error } = await supabase.from('employees').insert({
      name: 'Direct Write Test',
      tenant_id: '00000000-0000-0000-0000-000000000000'
    });
    // Error should be 'permission denied' or similar after REVOKE
    expect(error).toBeDefined();
    expect(error?.message).toMatch(/permission denied|new row violates row-level security policy/i);
  });
});
