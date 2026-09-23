import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260922029000_scope_doccob_profile_and_client.sql', 'utf8');

describe('escopo de perfil e cliente do DOCCOB', () => {
  it('deriva o cliente das próprias faturas e rejeita divergência', () => {
    expect(migration).toContain('_client_id IS DISTINCT FROM');
    expect(migration).toContain('count(DISTINCT invoice.client_id)=1');
    expect(migration).toContain("RAISE EXCEPTION 'doccob_client_mismatch'");
  });

  it('exige cliente e perfil ativos do mesmo tenant e perfil compatível com o pagador', () => {
    expect(migration).toContain('client.tenant_id=_tenant_id AND client.id=_client_id');
    expect(migration).toContain('profile.tenant_id=_tenant_id AND profile.id=_profile_id AND profile.enabled');
    expect(migration).toContain('(profile.client_id IS NULL OR profile.client_id=_client_id)');
    expect(migration).toContain("RAISE EXCEPTION 'doccob_profile_mismatch'");
  });
});
