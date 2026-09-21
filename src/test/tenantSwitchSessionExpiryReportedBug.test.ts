import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/hooks/useTenant.tsx', 'utf8');

describe('expired session during company switch', () => {
  it('validates the refresh token before persisting the requested company', () => {
    const explicitSwitch = source.slice(source.indexOf('const activateTenantId'));
    expect(explicitSwitch.indexOf('const validated=await refresh.call(authClient)'))
      .toBeLessThan(explicitSwitch.indexOf("supabase.rpc('set_active_tenant_context_v1',{_tenant_id:id})"));
  });

  it('rolls back a durable activation when the final token rotation fails', () => {
    expect(source).toContain('if(activationCommitted&&previousTenant)');
    expect(source).toContain("supabase.rpc('set_active_tenant_context_v1',{_tenant_id:previousTenant})");
  });

  it('explains that an expired session requires a new login', () => {
    expect(source).toContain('Sua sessão expirou. Saia e entre novamente para trocar de empresa.');
    expect(source).toContain('Entrar novamente');
    expect(source).toContain('void signOut()');
  });
});
