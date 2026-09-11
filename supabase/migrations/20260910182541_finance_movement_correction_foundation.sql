-- Infrastructure only. No correction command or application write grant is
-- exposed until operational readers and all dependent writers support voids.
-- A void corrects the recorded representation; it never sends bank money.
create table public.finance_movement_voids (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 movement_id uuid not null,
 original_request_id uuid not null,
 request_id uuid not null,
 kind text not null check(kind in ('void','duplicate','replacement')),
 duplicate_of_movement_id uuid,
 replacement_movement_id uuid,
 actor_id uuid not null,
 actor_name text not null check(length(btrim(actor_name)) between 1 and 300),
 reason text not null check(length(btrim(reason)) between 5 and 2000),
 revision text not null check(revision ~ '^[0-9a-f]{32}$'),
 source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object' and source_snapshot<>'{}'::jsonb),
 created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),
 unique(tenant_id,movement_id),
 unique(tenant_id,request_id),
 unique(tenant_id,replacement_movement_id),
 foreign key(tenant_id,movement_id) references public.finance_movements(tenant_id,id),
 foreign key(tenant_id,duplicate_of_movement_id) references public.finance_movements(tenant_id,id),
 foreign key(tenant_id,replacement_movement_id) references public.finance_movements(tenant_id,id),
 foreign key(tenant_id,original_request_id) references public.finance_commands(tenant_id,request_id),
 foreign key(tenant_id,request_id) references public.finance_commands(tenant_id,request_id) deferrable initially deferred,
 check(request_id<>original_request_id),
 check(duplicate_of_movement_id is distinct from movement_id),
 check(replacement_movement_id is distinct from movement_id),
 check(
  (kind='void' and duplicate_of_movement_id is null and replacement_movement_id is null) or
  (kind='duplicate' and duplicate_of_movement_id is not null and replacement_movement_id is null) or
  (kind='replacement' and replacement_movement_id is not null and duplicate_of_movement_id is null)
 )
);
create index finance_movement_voids_history on public.finance_movement_voids(tenant_id,created_at,id);
create index finance_movement_voids_original_request on public.finance_movement_voids(tenant_id,original_request_id);
create index finance_movement_voids_duplicate on public.finance_movement_voids(tenant_id,duplicate_of_movement_id)
 where duplicate_of_movement_id is not null;
create trigger preserve_finance_movement_void before update or delete on public.finance_movement_voids
 for each row execute function finance_private.preserve_event();
alter table public.finance_movement_voids enable row level security;
create policy finance_movement_voids_read on public.finance_movement_voids for select to authenticated
 using(finance_private.can_access(tenant_id));
revoke all on public.finance_movement_voids from public,anon,authenticated,service_role;

-- Same columns and monetary values as the original, without inactive records.
-- Private and ungranted: switching consumers is an explicit subsequent step.
create view finance_private.active_movements with (security_invoker=true) as
 select m.* from public.finance_movements m
 where not exists(select 1 from public.finance_movement_voids v
  where v.tenant_id=m.tenant_id and v.movement_id=m.id);
revoke all on finance_private.active_movements from public,anon,authenticated,service_role;
comment on table public.finance_movement_voids is
 'Append-only corrections of recorded money. No financial transaction is executed. Commands must validate origin, dependencies, periods and actor before insertion.';
