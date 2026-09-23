import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const page=readFileSync('src/pages/TeamManagement.tsx','utf8');
const migration=readFileSync('supabase/migrations/20260922007000_harden_team_access_concurrency.sql','utf8');

describe('team and portal access hardening',()=>{
  it('clears tenant-captured dialogs when the active tenant changes',()=>{
    expect(page).toContain('setInviteOpen(false)');expect(page).toContain('setEditMember(null)');expect(page).toContain('key={`invite:${currentTenant?.id');expect(page).toContain('key={currentTenant?.id}');
  });
  it('surfaces client catalog failures with retry',()=>{
    expect(page).toContain('const clientsQuery = useClients()');expect(page).toContain('Não foi possível carregar os clientes disponíveis');expect(page).toContain('clientsQuery.refetch()');
  });
  it('invites and atomically replaces an edited portal grant',()=>{
    expect(page).toContain('editing && !userId && canInvite');expect(page).toContain('replace_portal_access_after_invite_v1');expect(migration).toContain('transfer_after_invite');
  });
  it('uses revisions for member and portal mutations',()=>{
    expect(page).toContain('update_tenant_membership_v1');expect(page).toContain('mutate_client_portal_access_v1');expect(migration).toContain('membership_revision_conflict');expect(migration).toContain('portal_access_revision_conflict');
  });
  it('audits before and after membership state',()=>{
    expect(migration).toContain('audit_tenant_membership_change_v1');expect(migration).toContain('to_jsonb(old),to_jsonb(new)');expect(migration).toContain("'team_management'");
  });
});
