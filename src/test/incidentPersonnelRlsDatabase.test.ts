// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tenantA = '10000000-0000-4000-8000-000000000001';
const tenantB = '10000000-0000-4000-8000-000000000002';
const admin = '20000000-0000-4000-8000-000000000001';
const operator = '20000000-0000-4000-8000-000000000002';
const assigned = '20000000-0000-4000-8000-000000000003';
const peer = '20000000-0000-4000-8000-000000000004';
const otherTenant = '20000000-0000-4000-8000-000000000005';
const responsibleIds = {
  assigned: '40000000-0000-4000-8000-000000000001',
  peer: '40000000-0000-4000-8000-000000000002',
  otherTenant: '40000000-0000-4000-8000-000000000003',
};
const actionIds = {
  assigned: '50000000-0000-4000-8000-000000000001',
  peer: '50000000-0000-4000-8000-000000000002',
  otherTenant: '50000000-0000-4000-8000-000000000003',
};

let db: PGlite;

async function visibleIds(table: 'incident_responsible' | 'employee_incident_actions', user: string) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  await db.exec('set role authenticated');
  try {
    const { rows } = await db.query<{ id: string }>(`select id from public.${table} order by id`);
    return rows.map((row) => row.id);
  } finally {
    await db.exec('reset role');
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated;
    create schema auth;
    create schema private;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create table public.tenant_memberships(
      tenant_id uuid not null, user_id uuid not null, role text not null, active boolean not null
    );
    create table public.employees(id uuid primary key, tenant_id uuid not null, user_id uuid);
    create table public.incident_responsible(
      id uuid primary key, tenant_id uuid not null, employee_id uuid not null,
      assigned_user_id uuid, description text, final_opinion text, cost_assigned numeric
    );
    create table public.employee_incident_actions(
      id uuid primary key, tenant_id uuid not null, employee_id uuid not null,
      action_type text, description text, amount numeric
    );
    create function public.is_tenant_member(_tenant_id uuid) returns boolean
      language sql stable security definer set search_path = '' as $$
      select exists(select 1 from public.tenant_memberships membership
        where membership.tenant_id = _tenant_id and membership.user_id = auth.uid()
          and membership.active)
      $$;
    create function public.is_tenant_operator_or_admin(_tenant_id uuid) returns boolean
      language sql stable security definer set search_path = '' as $$
      select exists(select 1 from public.tenant_memberships membership
        where membership.tenant_id = _tenant_id and membership.user_id = auth.uid()
          and membership.active and membership.role in ('owner', 'admin', 'operator'))
      $$;
    create function private.is_request_tenant_member(_tenant_id uuid) returns boolean
      language sql stable security definer set search_path = '' as $$
      select exists(select 1 from public.tenant_memberships membership
        where membership.tenant_id = _tenant_id and membership.user_id = auth.uid()
          and membership.active)
      $$;
    grant usage on schema private to authenticated;
    grant execute on function private.is_request_tenant_member(uuid) to authenticated;
    alter table public.employees enable row level security;
    alter table public.incident_responsible enable row level security;
    alter table public.employee_incident_actions enable row level security;
    create policy employees_member_select on public.employees for select to authenticated
      using (public.is_tenant_member(tenant_id));
    create policy "Members can view incident_responsible" on public.incident_responsible
      for select to authenticated using (public.is_tenant_member(tenant_id));
    create policy agvlog_select_authenticated on public.incident_responsible
      for select to authenticated using (public.is_tenant_member(tenant_id));
    create policy agvlog_active_tenant_context on public.incident_responsible
      as restrictive for all to authenticated using (private.is_request_tenant_member(tenant_id));
    create policy eia_select on public.employee_incident_actions
      for select to authenticated using (public.is_tenant_member(tenant_id));
    create policy agvlog_select_authenticated on public.employee_incident_actions
      for select to authenticated using (public.is_tenant_member(tenant_id));
    create policy agvlog_active_tenant_context on public.employee_incident_actions
      as restrictive for all to authenticated using (private.is_request_tenant_member(tenant_id));
    grant select on public.employees, public.incident_responsible,
      public.employee_incident_actions to authenticated;
  `);
  await db.query(`insert into public.tenant_memberships values
    ($1,$3,'admin',true),($1,$4,'operator',true),($1,$5,'member',true),
    ($1,$6,'member',true),($2,$7,'member',true)`,
  [tenantA, tenantB, admin, operator, assigned, peer, otherTenant]);
  await db.query(`insert into public.employees values
    ('30000000-0000-4000-8000-000000000001',$1,$3),
    ('30000000-0000-4000-8000-000000000002',$1,$4),
    ('30000000-0000-4000-8000-000000000003',$2,$5)`,
  [tenantA, tenantB, assigned, peer, otherTenant]);
  await db.query(`insert into public.incident_responsible values
    ($1,$4,'30000000-0000-4000-8000-000000000001',$6,'own','own',10),
    ($2,$4,'30000000-0000-4000-8000-000000000002',$7,'peer','peer',20),
    ($3,$5,'30000000-0000-4000-8000-000000000003',$8,'other','other',30)`,
  [responsibleIds.assigned, responsibleIds.peer, responsibleIds.otherTenant,
    tenantA, tenantB, assigned, peer, otherTenant]);
  await db.query(`insert into public.employee_incident_actions values
    ($1,$4,'30000000-0000-4000-8000-000000000001','note','own',10),
    ($2,$4,'30000000-0000-4000-8000-000000000002','note','peer',20),
    ($3,$5,'30000000-0000-4000-8000-000000000003','note','other',30)`,
  [actionIds.assigned, actionIds.peer, actionIds.otherTenant, tenantA, tenantB]);
  await db.exec(readFileSync(
    'supabase/migrations/20260926184015_restrict_incident_personnel_reads.sql', 'utf8'));
}, 15000);

afterAll(async () => { await db?.close(); });

describe('personnel incident row policies', () => {
  it('shows an ordinary member only their assigned records', async () => {
    expect(await visibleIds('incident_responsible', assigned)).toEqual([responsibleIds.assigned]);
    expect(await visibleIds('employee_incident_actions', assigned)).toEqual([actionIds.assigned]);
    expect(await visibleIds('incident_responsible', peer)).toEqual([responsibleIds.peer]);
    expect(await visibleIds('employee_incident_actions', peer)).toEqual([actionIds.peer]);
  });

  it('preserves incident management for active operators and administrators', async () => {
    for (const user of [operator, admin]) {
      expect(await visibleIds('incident_responsible', user))
        .toEqual([responsibleIds.assigned, responsibleIds.peer]);
      expect(await visibleIds('employee_incident_actions', user))
        .toEqual([actionIds.assigned, actionIds.peer]);
    }
  });

  it('does not reveal another tenant or retain access after membership revocation', async () => {
    expect(await visibleIds('incident_responsible', otherTenant)).toEqual([responsibleIds.otherTenant]);
    expect(await visibleIds('employee_incident_actions', otherTenant)).toEqual([actionIds.otherTenant]);
    await db.query('update public.tenant_memberships set active = false where user_id = $1', [assigned]);
    expect(await visibleIds('incident_responsible', assigned)).toEqual([]);
    expect(await visibleIds('employee_incident_actions', assigned)).toEqual([]);
  });

  it('does not trust a stale assignment after an employee account is rebound', async () => {
    await db.query('update public.tenant_memberships set active = true where user_id = $1', [assigned]);
    await db.query('update public.employees set user_id = $1 where id = $2',
      [peer, '30000000-0000-4000-8000-000000000001']);
    expect(await visibleIds('incident_responsible', assigned)).toEqual([]);
    expect(await visibleIds('incident_responsible', peer)).toEqual([responsibleIds.peer]);
  });

  it('also restricts the published schema before assigned_user_id exists', async () => {
    await db.exec('drop policy "Assigned employees and operators can view incident_responsible" on public.incident_responsible');
    await db.exec('alter table public.incident_responsible drop column assigned_user_id');
    await db.exec(`create policy agvlog_select_authenticated on public.incident_responsible
      for select to authenticated using (public.is_tenant_member(tenant_id))`);
    await db.query('update public.employees set user_id = $1 where id = $2',
      [assigned, '30000000-0000-4000-8000-000000000001']);
    expect(await visibleIds('incident_responsible', assigned))
      .toEqual([responsibleIds.assigned, responsibleIds.peer]);

    await db.exec(readFileSync(
      'supabase/migrations/20260926184015_restrict_incident_personnel_reads.sql', 'utf8'));
    expect(await visibleIds('incident_responsible', assigned)).toEqual([responsibleIds.assigned]);
    expect(await visibleIds('employee_incident_actions', assigned)).toEqual([actionIds.assigned]);
  });
});
