import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const ids = {
  tenant: '21000000-0000-4000-8000-000000000001',
  otherTenant: '21000000-0000-4000-8000-000000000002',
  actor: '11000000-0000-4000-8000-000000000001',
  otherActor: '11000000-0000-4000-8000-000000000002',
  client: '31000000-0000-4000-8000-000000000001',
  viewOnlyClient: '31000000-0000-4000-8000-000000000002',
  hiddenClient: '31000000-0000-4000-8000-000000000003',
  foreignClient: '31000000-0000-4000-8000-000000000004',
  occurrence: '41000000-0000-4000-8000-000000000001',
  viewOnlyOccurrence: '41000000-0000-4000-8000-000000000002',
  hiddenOccurrence: '41000000-0000-4000-8000-000000000003',
  foreignOccurrence: '41000000-0000-4000-8000-000000000004',
  revokedVisibility: '41000000-0000-4000-8000-000000000005',
  resolvedOccurrence: '41000000-0000-4000-8000-000000000006',
  pickup: '51000000-0000-4000-8000-000000000001',
  viewOnlyPickup: '51000000-0000-4000-8000-000000000002',
  taxMatchedPickup: '51000000-0000-4000-8000-000000000003',
  foreignPickup: '51000000-0000-4000-8000-000000000004',
  linkedPickup: '51000000-0000-4000-8000-000000000005',
  request: '61000000-0000-4000-8000-000000000001',
};
export const signatures = [
  'public.list_client_pickups_page_v1(uuid,uuid,text,timestamptz,timestamptz,integer,timestamptz,jsonb,text)',
  'public.list_client_occurrences_page_v1(uuid,uuid,text,boolean,integer,timestamptz,jsonb,text)',
];
const migration = (filename: string) => readFileSync(`supabase/migrations/${filename}.sql`, 'utf8')
  .replace(/\r\n/g, '\n');

// Extract actual predecessor definitions; do not fabricate a permissive RPC/helper.
function definition(source: string, name: string, embedded = false): string {
  const prefix = embedded ? 'create function' : 'create or replace function';
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${prefix} public\\.${escaped}\\([\\s\\S]*?\\$function\\$;`, 'i').exec(source);
  if (!match) throw new Error(`Real Portal predecessor missing: ${name}`);
  return match[0];
}

export async function setupPortal(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth to anon,authenticated,service_role;
    create table public.clients(id uuid primary key,tenant_id uuid not null,tax_id text);
    create table public.client_portal_access(
      tenant_id uuid not null,user_id uuid not null,client_id uuid not null references public.clients,
      access_type text not null,active boolean not null,
      can_open_occurrences boolean not null,can_request_pickup boolean not null,
      primary key(tenant_id,user_id,client_id)
    );
    create table public.operational_events(
      id uuid primary key,tenant_id uuid not null,client_id uuid references public.clients,
      load_id uuid,order_id uuid,fiscal_document_id uuid,event_type text not null,
      severity text not null,description text,public_status text,client_action_required boolean not null default false,
      visible_to_client boolean not null default false,client_opened boolean not null default false,
      client_resolution_note text,resolution text,resolved_at timestamptz,created_by uuid,
      created_at timestamptz not null,updated_at timestamptz not null,idempotency_key text
    );
    create unique index operational_events_idempotency_key_uidx
      on public.operational_events(tenant_id,idempotency_key) where idempotency_key is not null;
    create table public.pickup_orders(
      id uuid primary key,tenant_id uuid not null,remitter_client_id uuid references public.clients,
      pickup_number text not null,remitter_name text,remitter_cnpj text,recipient_name text,
      pickup_at timestamptz not null,status text not null check(status in('pendente','vinculada','finalizada','cancelada')),
      notes text,created_at timestamptz not null,updated_at timestamptz not null,
      portal_cancel_request_id uuid,portal_cancelled_by uuid,portal_cancellation_reason text,
      portal_cancelled_at timestamptz
    );
    create unique index pickup_orders_portal_cancel_request_uidx
      on public.pickup_orders(tenant_id,portal_cancel_request_id) where portal_cancel_request_id is not null;
    create table public.fiscal_documents(id uuid primary key,pickup_order_id uuid);
    create table public.client_occurrence_messages(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null,
      occurrence_id uuid not null references public.operational_events,author_user_id uuid,
      author_role text not null,message text not null,request_id uuid,
      created_at timestamptz not null default now()
    );
    create unique index client_occurrence_messages_request_uidx
      on public.client_occurrence_messages(tenant_id,request_id) where request_id is not null;
    create table public.tenant_memberships(tenant_id uuid,user_id uuid,role text,active boolean);
    create table public.entity_audit_log(
      id uuid primary key default gen_random_uuid(),tenant_id uuid,entity_type text,entity_id uuid,
      action text,old_data jsonb,new_data jsonb,actor_user_id uuid,actor_role text,source text
    );
    alter table public.client_portal_access enable row level security;
    create policy own_access on public.client_portal_access for select to authenticated using(user_id=auth.uid());
    create function public.portal_fixture_noop() returns trigger language plpgsql as $$begin return new;end$$;
    create trigger portal_fixture_before_update before update on public.pickup_orders
      for each row execute function public.portal_fixture_noop();
    insert into public.clients values
      ('${ids.client}','${ids.tenant}','111'),('${ids.viewOnlyClient}','${ids.tenant}','222'),
      ('${ids.hiddenClient}','${ids.tenant}','333'),('${ids.foreignClient}','${ids.otherTenant}','444');
    insert into public.client_portal_access values
      ('${ids.tenant}','${ids.actor}','${ids.client}','full',true,true,true),
      ('${ids.tenant}','${ids.actor}','${ids.viewOnlyClient}','full',true,false,false);
    insert into public.operational_events
      (id,tenant_id,client_id,event_type,severity,description,visible_to_client,client_opened,resolved_at,created_at,updated_at)
      values
      ('${ids.occurrence}','${ids.tenant}','${ids.client}','avaria','medium','Own',true,true,null,'2026-10-01T10:00Z','2026-10-01T10:00Z'),
      ('${ids.viewOnlyOccurrence}','${ids.tenant}','${ids.viewOnlyClient}','avaria','medium','Read only',true,false,null,'2026-10-01T09:00Z','2026-10-01T09:00Z'),
      ('${ids.hiddenOccurrence}','${ids.tenant}','${ids.hiddenClient}','avaria','medium','Other client',true,false,null,'2026-10-01T08:00Z','2026-10-01T08:00Z'),
      ('${ids.foreignOccurrence}','${ids.otherTenant}','${ids.foreignClient}','avaria','medium','Other tenant',true,false,null,'2026-10-01T07:00Z','2026-10-01T07:00Z'),
      ('${ids.revokedVisibility}','${ids.tenant}','${ids.client}','avaria','medium','Visibility revoked',false,true,null,'2026-10-01T06:00Z','2026-10-01T06:00Z'),
      ('${ids.resolvedOccurrence}','${ids.tenant}','${ids.client}','avaria','high','Resolved',true,false,'2026-10-01T05:01Z','2026-10-01T05:00Z','2026-10-01T05:01Z');
    insert into public.pickup_orders
      (id,tenant_id,remitter_client_id,pickup_number,remitter_cnpj,pickup_at,status,created_at,updated_at)
      values
      ('${ids.pickup}','${ids.tenant}','${ids.client}','1','111','2026-10-02T10:00Z','pendente','2026-10-01T10:00Z','2026-10-01T10:00Z'),
      ('${ids.viewOnlyPickup}','${ids.tenant}','${ids.viewOnlyClient}','2','222','2026-10-02T09:00Z','pendente','2026-10-01T09:00Z','2026-10-01T09:00Z'),
      ('${ids.taxMatchedPickup}','${ids.tenant}','${ids.hiddenClient}','3','111','2026-10-02T08:00Z','pendente','2026-10-01T08:00Z','2026-10-01T08:00Z'),
      ('${ids.foreignPickup}','${ids.otherTenant}','${ids.foreignClient}','4','444','2026-10-02T07:00Z','pendente','2026-10-01T07:00Z','2026-10-01T07:00Z'),
      ('${ids.linkedPickup}','${ids.tenant}','${ids.client}','5','111','2026-10-02T06:00Z','vinculada','2026-10-01T06:00Z','2026-10-01T06:00Z');
    select set_config('request.jwt.claim.sub','${ids.actor}',false);
  `);
  const baseline = migration('20260824224152_baseline');
  for (const [name,signature] of [
    ['_portal_assert_client_access','public._portal_assert_client_access(uuid,uuid)'],
    ['_portal_user_client_ids','public._portal_user_client_ids(uuid)'],
    ['_portal_user_has_perm','public._portal_user_has_perm(uuid,uuid,text)'],
    ['portal_user_can_access_pickup_order','public.portal_user_can_access_pickup_order(uuid,uuid)'],
    ['_log_entity_audit','public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text)'],
  ]) {
    await db.exec(definition(baseline,name));
    await db.exec(`revoke all on function ${signature} from public,anon,authenticated,service_role;
      grant execute on function ${signature} to service_role;`);
  }
  const pages = migration('20260917152100_page_portal_operational_lists');
  for (const name of ['list_client_pickups_page_v1','list_client_occurrences_page_v1']) {
    await db.exec(definition(pages,name));
  }
  for (const signature of signatures) {
    await db.exec(`revoke all on function ${signature} from public,anon,authenticated,service_role;
      grant execute on function ${signature} to authenticated,service_role;`);
  }
  const commands = migration('20260926191248_restore_portal_occurrence_command_rpcs');
  for (const [name,signature] of [
    ['reply_client_occurrence_v2','public.reply_client_occurrence_v2(uuid,uuid,text,uuid)'],
    ['cancel_client_pickup_v2','public.cancel_client_pickup_v2(uuid,uuid,text,uuid)'],
  ]) {
    await db.exec(definition(commands,name,true));
    await db.exec(`revoke all on function ${signature} from public,anon,authenticated,service_role;
      grant execute on function ${signature} to authenticated,service_role;`);
  }
  return db;
}

export async function asRole<T>(db: PGlite, sql: string, params: unknown[] = [], role = 'authenticated') {
  if (!['authenticated','anon','service_role'].includes(role)) throw new Error('Invalid fixture role');
  await db.exec(`begin; set local role ${role}`);
  try {
    const result = await db.query<T>(sql,params);
    await db.exec('commit');
    return result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

export async function catalog(db: PGlite) {
  return (await db.query(`select jsonb_build_object(
    'functions',(select jsonb_agg(to_jsonb(p)-'prosrc' order by p.proname)
      from pg_proc p where p.oid in($1::regprocedure,$2::regprocedure)),
    'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c where c.connamespace='public'::regnamespace),
    'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
    'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t where not t.tgisinternal)
  ) value`,signatures)).rows[0];
}
