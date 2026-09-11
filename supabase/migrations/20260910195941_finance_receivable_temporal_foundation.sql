-- Capture time is NOT transaction commit visibility. No historical position API.
begin;
lock table public.tenants in share row exclusive mode;
-- Do not hold tenants while waiting on a row-first writer of receivables.
-- Retry the whole migration on 55P03; readers remain available.
lock table public.receivables in share row exclusive mode nowait;

create table finance_private.receivable_temporal_coverage(
 tenant_id uuid primary key,
 coverage_starts_at timestamptz not null,
 baseline_kind text not null check(baseline_kind in('existing_tenant','new_tenant')),
 capture_basis text not null default 'transaction_capture_not_commit' check(capture_basis='transaction_capture_not_commit'),
 transaction_id bigint not null
);
create table finance_private.receivable_temporal_versions(
 event_order bigint generated always as identity primary key,
 tenant_id uuid not null references finance_private.receivable_temporal_coverage(tenant_id),
 receivable_id uuid not null,
 operation text not null check(operation in('BASELINE','INSERT','UPDATE','DELETE')),
 old_data jsonb,new_data jsonb,old_payer_snapshot jsonb,new_payer_snapshot jsonb,
 actor_id uuid,actor_name text,
 actor_kind text not null check(actor_kind in('authenticated','system')),
 captured_at timestamptz not null default clock_timestamp(),
 transaction_id bigint not null default txid_current(),
 check((actor_id is null and actor_kind='system') or (actor_id is not null and actor_kind='authenticated')),
 check((operation in('BASELINE','INSERT') and old_data is null and new_data is not null)
  or (operation='UPDATE' and old_data is not null and new_data is not null)
  or (operation='DELETE' and old_data is not null and new_data is null)),
 check(old_data is null or coalesce(jsonb_typeof(old_data)='object' and old_data->>'tenant_id'=tenant_id::text and old_data->>'id'=receivable_id::text,false)),
 check(new_data is null or coalesce(jsonb_typeof(new_data)='object' and new_data->>'tenant_id'=tenant_id::text and new_data->>'id'=receivable_id::text,false))
);
create index receivable_temporal_target on finance_private.receivable_temporal_versions(tenant_id,receivable_id,event_order);
create index receivable_temporal_capture on finance_private.receivable_temporal_versions(tenant_id,captured_at,event_order);
alter table finance_private.receivable_temporal_coverage enable row level security;
alter table finance_private.receivable_temporal_versions enable row level security;
create policy receivable_temporal_coverage_finance on finance_private.receivable_temporal_coverage for select to authenticated using(finance_private.can_access(tenant_id));
create policy receivable_temporal_versions_finance on finance_private.receivable_temporal_versions for select to authenticated using(finance_private.can_access(tenant_id));
revoke all on finance_private.receivable_temporal_coverage,finance_private.receivable_temporal_versions from public,anon,authenticated,service_role;
revoke all on sequence finance_private.receivable_temporal_versions_event_order_seq from public,anon,authenticated,service_role;

create function finance_private.preserve_receivable_temporal_history() returns trigger
language plpgsql security definer set search_path='' as $$
begin raise exception 'finance_receivable_temporal_history_immutable' using errcode='55000';end$$;
revoke all on function finance_private.preserve_receivable_temporal_history() from public,anon,authenticated,service_role;
create trigger preserve_receivable_temporal_coverage before update or delete on finance_private.receivable_temporal_coverage for each row execute function finance_private.preserve_receivable_temporal_history();
create trigger preserve_receivable_temporal_versions before update or delete on finance_private.receivable_temporal_versions for each row execute function finance_private.preserve_receivable_temporal_history();
create trigger preserve_receivable_temporal_coverage_truncate before truncate on finance_private.receivable_temporal_coverage for each statement execute function finance_private.preserve_receivable_temporal_history();
create trigger preserve_receivable_temporal_versions_truncate before truncate on finance_private.receivable_temporal_versions for each statement execute function finance_private.preserve_receivable_temporal_history();

create function finance_private.capture_receivable_temporal_version() returns trigger
language plpgsql security definer set search_path='' as $$
declare source_tenant uuid;source_id uuid;actor uuid:=auth.uid();actor_label text;
begin
 if tg_op='DELETE' then source_tenant:=old.tenant_id;source_id:=old.id;
 else source_tenant:=new.tenant_id;source_id:=new.id;end if;
 if tg_op='UPDATE' and (old.tenant_id,old.id) is distinct from (new.tenant_id,new.id) then
  raise exception 'finance_receivable_temporal_identity_immutable' using errcode='55000';end if;
 -- Capture all successful writers, including workers without an auth actor.
 -- Authorization remains with the original writer; this is not a write API.
 select coalesce(u.raw_user_meta_data->>'full_name',u.email) into actor_label from auth.users u where u.id=actor;
 insert into finance_private.receivable_temporal_versions(tenant_id,receivable_id,operation,old_data,new_data,old_payer_snapshot,new_payer_snapshot,actor_id,actor_name,actor_kind)
 values(source_tenant,source_id,tg_op,case when tg_op<>'INSERT' then to_jsonb(old) end,
  case when tg_op<>'DELETE' then to_jsonb(new) end,
  case when tg_op<>'INSERT' then (select jsonb_build_object('id',c.id,'tenant_id',c.tenant_id,'company_name',c.company_name) from public.clients c where c.tenant_id=source_tenant and c.id=old.client_id) end,
  case when tg_op<>'DELETE' then (select jsonb_build_object('id',c.id,'tenant_id',c.tenant_id,'company_name',c.company_name) from public.clients c where c.tenant_id=source_tenant and c.id=new.client_id) end,
  actor,actor_label,case when actor is null then 'system' else 'authenticated' end);
 return null;
end$$;
revoke all on function finance_private.capture_receivable_temporal_version() from public,anon,authenticated,service_role;

create function finance_private.start_receivable_temporal_coverage() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into finance_private.receivable_temporal_coverage(tenant_id,coverage_starts_at,baseline_kind,transaction_id)
 values(new.id,clock_timestamp(),'new_tenant',txid_current()) on conflict(tenant_id) do nothing;
 return new;
end$$;
revoke all on function finance_private.start_receivable_temporal_coverage() from public,anon,authenticated,service_role;

-- The table locks exclude concurrent title/tenant changes throughout the baseline.
with locked_cut as materialized(select clock_timestamp() as captured_at)
insert into finance_private.receivable_temporal_coverage(tenant_id,coverage_starts_at,baseline_kind,transaction_id)
select t.id,c.captured_at,'existing_tenant',txid_current() from public.tenants t cross join locked_cut c order by t.id;
insert into finance_private.receivable_temporal_versions(tenant_id,receivable_id,operation,old_data,new_data,new_payer_snapshot,actor_id,actor_name,actor_kind,captured_at)
select r.tenant_id,r.id,'BASELINE',null,to_jsonb(r),(select jsonb_build_object('id',p.id,'tenant_id',p.tenant_id,'company_name',p.company_name) from public.clients p where p.id=r.client_id and p.tenant_id=r.tenant_id),auth.uid(),(select coalesce(u.raw_user_meta_data->>'full_name',u.email) from auth.users u where u.id=auth.uid()),case when auth.uid() is null then 'system' else 'authenticated' end,c.coverage_starts_at
from public.receivables r join finance_private.receivable_temporal_coverage c on c.tenant_id=r.tenant_id order by r.tenant_id,r.id;
-- Fail closed on orphan tenant data instead of silently omitting a title.
do $$begin
 if exists(select 1 from public.receivables r where not exists(select 1 from finance_private.receivable_temporal_coverage c where c.tenant_id=r.tenant_id)) then
 raise exception 'finance_receivable_temporal_orphan_tenant' using errcode='23514';end if;
end$$;
create trigger a_receivable_temporal_new_tenant before insert on public.tenants for each row execute function finance_private.start_receivable_temporal_coverage();
create trigger z_receivable_temporal_capture after insert or update or delete on public.receivables for each row execute function finance_private.capture_receivable_temporal_version();
create trigger preserve_receivable_temporal_source_truncate before truncate on public.receivables for each statement execute function finance_private.preserve_receivable_temporal_history();
comment on table finance_private.receivable_temporal_coverage is 'Coverage starts at locked baseline capture; not certification of preceding history or commit visibility.';
comment on column finance_private.receivable_temporal_versions.event_order is 'Sequence allocation order, with possible gaps; not transaction commit order.';
commit;
