// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260926191248_restore_portal_occurrence_command_rpcs.sql', 'utf8');
const tenant = '10000000-0000-4000-8000-000000000001';
const otherTenant = '10000000-0000-4000-8000-000000000002';
const user = '20000000-0000-4000-8000-000000000001';
const client = '30000000-0000-4000-8000-000000000001';
const otherClient = '30000000-0000-4000-8000-000000000002';
const document = '40000000-0000-4000-8000-000000000001';
const otherDocument = '40000000-0000-4000-8000-000000000002';
const load = '50000000-0000-4000-8000-000000000001';
const pickup = '60000000-0000-4000-8000-000000000001';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
    create table public.portal_access(tenant_id uuid,user_id uuid,client_id uuid,
      can_open_occurrences boolean,can_request_pickup boolean);
    create function public._portal_user_has_perm(t uuid,c uuid,p text)
      returns boolean language sql stable as $$select exists(
        select 1 from public.portal_access a where a.tenant_id=t and a.client_id=c
        and a.user_id=auth.uid() and case p
          when 'can_open_occurrences' then a.can_open_occurrences
          when 'can_request_pickup' then a.can_request_pickup else false end)$$;
    create function public._portal_user_client_ids(t uuid) returns uuid[]
      language sql stable as $$select coalesce(array_agg(client_id),'{}'::uuid[])
        from public.portal_access where tenant_id=t and user_id=auth.uid()$$;
    create table public.audit_log(id bigint generated always as identity,tenant_id uuid,
      entity_type text,entity_id uuid,action text,old_data jsonb,new_data jsonb,source text);
    create function public._log_entity_audit(t uuid,typ text,e uuid,a text,o jsonb,n jsonb,s text)
      returns void language plpgsql as $$begin
        insert into public.audit_log(tenant_id,entity_type,entity_id,action,old_data,new_data,source)
        values(t,typ,e,a,o,n,s); end$$;
    create table public.operational_events(
      id uuid primary key default gen_random_uuid(),tenant_id uuid,client_id uuid,load_id uuid,
      order_id uuid,fiscal_document_id uuid,event_type text,description text,severity text,
      created_by uuid,visible_to_client boolean default true,client_opened boolean default false,
      resolved_at timestamptz,updated_at timestamptz default now(),idempotency_key text);
    create unique index uq_operational_events_idempotency
      on public.operational_events(tenant_id,idempotency_key) where idempotency_key is not null;
    create table public.fiscal_documents(id uuid primary key,tenant_id uuid,client_id uuid,
      load_id uuid,deleted_at timestamptz);
    create table public.client_occurrence_messages(
      id uuid primary key default gen_random_uuid(),tenant_id uuid,occurrence_id uuid,
      author_user_id uuid,author_role text,message text);
    create table public.pickup_orders(
      id uuid primary key,tenant_id uuid,remitter_client_id uuid,status text,
      updated_at timestamptz default now());
    create function public.create_client_occurrence(
      t uuid,c uuid,typ text,description text,severity text,l uuid,o uuid)
      returns uuid language plpgsql security definer set search_path='public' as $fn$
      declare event_id uuid;
      begin
        if not public._portal_user_has_perm(t,c,'can_open_occurrences') then
          raise exception 'Permission denied';
        end if;
        insert into public.operational_events
          (tenant_id,client_id,load_id,order_id,event_type,description,severity,created_by)
        values(t,c,l,o,typ,description,severity,auth.uid()) returning id into event_id;
        return event_id;
      end$fn$;
    insert into public.portal_access values
      ('${tenant}','${user}','${client}',true,true);
    insert into public.fiscal_documents values
      ('${document}','${tenant}','${client}','${load}',null),
      ('${otherDocument}','${otherTenant}','${otherClient}',null,null);
    insert into public.pickup_orders(id,tenant_id,remitter_client_id,status)
      values('${pickup}','${tenant}','${client}','pendente');
  `);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec(migration);
}, 20_000);

afterAll(async () => { await db?.close(); });

describe('published Portal occurrence commands', () => {
  it('installs only missing signatures with authenticated access and preserves them on retry', async () => {
    for (const signature of [
      'public.create_client_occurrence_v3(uuid,uuid,text,text,uuid,text,uuid,uuid,uuid)',
      'public.reply_client_occurrence_v2(uuid,uuid,text,uuid)',
      'public.cancel_client_pickup_v2(uuid,uuid,text,uuid)',
    ]) {
      const before = (await db.query<{ body: string; definer: boolean; auth: boolean; anon: boolean }>(`
        select p.prosrc body,p.prosecdef definer,
          has_function_privilege('authenticated',$1,'execute') auth,
          has_function_privilege('anon',$1,'execute') anon
        from pg_proc p where p.oid=to_regprocedure($1)`, [signature])).rows[0];
      expect(before).toMatchObject({ definer: true, auth: true, anon: false });
      await db.exec(migration);
      const after = (await db.query<{ body: string }>(
        'select prosrc body from pg_proc where oid=to_regprocedure($1)', [signature])).rows[0];
      expect(after.body).toBe(before.body);
    }
  });

  it('links an authorized document once and rejects changed or foreign document retries', async () => {
    const request = '70000000-0000-4000-8000-000000000001';
    const call = (doc: string, requestId = request) => db.query<{ id: string }>(
      'select public.create_client_occurrence_v3($1,$2,$3,$4,$5,$6,$7,$8,$9) id',
      [tenant, client, 'Avaria', 'Descrição da ocorrência', requestId, 'high', null, null, doc]);
    const first = (await call(document)).rows[0].id;
    expect((await call(document)).rows[0].id).toBe(first);
    expect((await db.query<{ load_id: string; fiscal_document_id: string }>(
      'select load_id,fiscal_document_id from public.operational_events where id=$1', [first])).rows[0])
      .toEqual({ load_id: load, fiscal_document_id: document });
    await expect(call(otherDocument, '70000000-0000-4000-8000-000000000002'))
      .rejects.toThrow('access_denied');
    await expect(call(null as unknown as string)).rejects.toThrow('portal_occurrence_request_id_mismatch');
    expect((await db.query<{ n: number }>(
      'select count(*)::integer n from public.operational_events')).rows[0].n).toBe(1);
  });

  it('deduplicates replies and refuses a resolved occurrence', async () => {
    const occurrence = (await db.query<{ id: string }>(
      'select id from public.operational_events limit 1')).rows[0].id;
    const request = '70000000-0000-4000-8000-000000000003';
    const call = (message: string) => db.query<{ id: string }>(
      'select public.reply_client_occurrence_v2($1,$2,$3,$4) id',
      [tenant, occurrence, message, request]);
    const first = (await call('Mensagem de acompanhamento')).rows[0].id;
    expect((await call('Mensagem de acompanhamento')).rows[0].id).toBe(first);
    await expect(call('Outra mensagem')).rejects.toThrow('portal_occurrence_request_id_mismatch');
    await db.query('update public.operational_events set resolved_at=now() where id=$1', [occurrence]);
    await expect(db.query('select public.reply_client_occurrence_v2($1,$2,$3,$4)',
      [tenant, occurrence, 'Outra resposta', '70000000-0000-4000-8000-000000000004']))
      .rejects.toThrow('portal_occurrence_already_resolved');
    expect((await db.query<{ n: number }>(
      'select count(*)::integer n from public.client_occurrence_messages')).rows[0].n).toBe(1);
  });

  it('audits a cancellation once, and rejects conflicting or unauthorized attempts', async () => {
    const request = '70000000-0000-4000-8000-000000000005';
    const call = (reason: string, pickupId = pickup) => db.query(
      'select public.cancel_client_pickup_v2($1,$2,$3,$4)', [tenant, pickupId, reason, request]);
    await call('Cliente cancelou a coleta');
    await call('Cliente cancelou a coleta');
    await expect(call('Cliente mudou o motivo')).rejects.toThrow('Only pending pickups');
    expect((await db.query<{ status: string; reason: string }>(
      'select status,portal_cancellation_reason reason from public.pickup_orders where id=$1', [pickup])).rows[0])
      .toEqual({ status: 'cancelada', reason: 'Cliente cancelou a coleta' });
    expect((await db.query<{ n: number }>(
      "select count(*)::integer n from public.audit_log where action='cancel_by_client'")).rows[0].n).toBe(1);
    const foreignPickup = '60000000-0000-4000-8000-000000000002';
    await db.query('insert into public.pickup_orders(id,tenant_id,remitter_client_id,status) values($1,$2,$3,$4)',
      [foreignPickup, tenant, otherClient, 'pendente']);
    await expect(call('Cliente cancelou a coleta', foreignPickup)).rejects.toThrow('Permission denied');
  });
});
