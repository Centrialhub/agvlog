import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/BillingEdi.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20260922030000_prevent_ambiguous_active_doccob_profiles.sql', 'utf8');

describe('ambiguidade de perfil DOCCOB', () => {
  it('não escolhe silenciosamente o primeiro perfil aplicável', () => {
    expect(page).toContain('const profileAmbiguous = applicableProfiles.length > 1');
    expect(page).toContain('const clientProfile = applicableProfiles.length === 1 ? applicableProfiles[0] : null');
    expect(page).toContain('disabled={selectedInvoices.length === 0 || profileAmbiguous}');
    expect(page).toContain('perfis DOCCOB ativos aplicáveis');
  });

  it('serializa e rejeita novas duplicidades ativas no banco', () => {
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('profile.client_id is not distinct from new.client_id');
    expect(migration).toContain("raise exception 'doccob_active_profile_ambiguous'");
    expect(migration).toContain('before insert or update of tenant_id, client_id, enabled');
  });
});
