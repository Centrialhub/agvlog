import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// Minimal mock client for testing error messages
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || 'dummy';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

describe('Security Matrix Hardening', () => {
  it('should deny execute_data_repair_v1 to everyone', async () => {
    // Attempting to call from anon client
    const { error: error1 } = await supabase.rpc('execute_data_repair_v1', {
      _tenant_id: '00000000-0000-0000-0000-000000000000',
      _batch_id: '00000000-0000-0000-0000-000000000000'
    });
    
    const { error: error2 } = await supabase.rpc('execute_data_repair_v1', {
      p_tenant_id: '00000000-0000-0000-0000-000000000000',
      p_batch_id: '00000000-0000-0000-0000-000000000000',
      p_dry_run: true
    });
    
    // Anon role should be blocked by "permission denied" because EXECUTE was revoked from PUBLIC
    // Or if the function is not in the schema, it might return a different error, 
    // but we know it exists because we created it.
    expect(error1?.message).toMatch(/permission denied|FEATURE_DISABLED/);
    expect(error2?.message).toMatch(/permission denied|FEATURE_DISABLED/);
  });
});
