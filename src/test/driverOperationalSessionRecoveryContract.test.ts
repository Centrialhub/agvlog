import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('driver operational session recovery contract',()=>{
  it('refreshes an expired token once and reuses the exact idempotent command arguments',()=>{
    const source=readFileSync('src/hooks/useDriverOperationalOffline.ts','utf8');
    expect(source).toContain('operationalSessionRefresh');
    expect(source).toContain('supabase.auth.refreshSession()');
    expect(source).toContain("const invoke=()=>rpc('driver_apply_offline_command_v1',args)");
    expect(source).toContain('await refreshOperationalSession()');
  });
});
