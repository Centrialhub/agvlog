-- Bug 1169: history pagination must not re-hash the complete immutable journal.
create table finance_private.receivable_history_revisions(
 tenant_id uuid not null,
 scope_key text not null,
 event_count bigint not null check(event_count>=0),
 change_token uuid not null,
 primary key(tenant_id,scope_key)
);

alter table finance_private.receivable_history_revisions enable row level security;
revoke all on finance_private.receivable_history_revisions from public,anon,authenticated,service_role;

-- Seed one tenant-wide head even when the tenant has no captured versions.
insert into finance_private.receivable_history_revisions(tenant_id,scope_key,event_count,change_token)
select c.tenant_id,'*',count(v.event_order),gen_random_uuid()
from finance_private.receivable_temporal_coverage c
left join finance_private.receivable_temporal_versions v on v.tenant_id=c.tenant_id
group by c.tenant_id;

insert into finance_private.receivable_history_revisions(tenant_id,scope_key,event_count,change_token)
select v.tenant_id,v.receivable_id::text,count(*),gen_random_uuid()
from finance_private.receivable_temporal_versions v
group by v.tenant_id,v.receivable_id;

create function finance_private.advance_receivable_history_revision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into finance_private.receivable_history_revisions(tenant_id,scope_key,event_count,change_token)
 values(new.tenant_id,'*',1,gen_random_uuid())
 on conflict(tenant_id,scope_key) do update
 set event_count=finance_private.receivable_history_revisions.event_count+1,
     change_token=excluded.change_token;

 insert into finance_private.receivable_history_revisions(tenant_id,scope_key,event_count,change_token)
 values(new.tenant_id,new.receivable_id::text,1,gen_random_uuid())
 on conflict(tenant_id,scope_key) do update
 set event_count=finance_private.receivable_history_revisions.event_count+1,
     change_token=excluded.change_token;
 return null;
end$$;
revoke all on function finance_private.advance_receivable_history_revision() from public,anon,authenticated,service_role;

create trigger advance_receivable_history_revision
after insert on finance_private.receivable_temporal_versions
for each row execute function finance_private.advance_receivable_history_revision();

create index receivable_temporal_tenant_order
on finance_private.receivable_temporal_versions(tenant_id,event_order desc);

create or replace function finance_private.receivable_captured_history(_tenant uuid,_receivable uuid,_page integer,_expected_revision text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare coverage jsonb;revision text;total bigint;rows jsonb;token text;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page<1 then raise exception 'finance_invalid_history_page' using errcode='22023';end if;
 if _page>1 and _expected_revision is null then raise exception 'finance_history_revision_required' using errcode='22023';end if;
 select jsonb_build_object('starts_at',c.coverage_starts_at,'baseline_kind',c.baseline_kind,'capture_basis',c.capture_basis)
 into coverage from finance_private.receivable_temporal_coverage c where c.tenant_id=_tenant;
 select r.event_count,r.change_token::text into total,token
 from finance_private.receivable_history_revisions r
 where r.tenant_id=_tenant and r.scope_key=coalesce(_receivable::text,'*');
 total:=coalesce(total,0);token:=coalesce(token,'empty');
 revision:=md5(jsonb_build_object('version',2,'tenant_id',_tenant,'receivable_id',_receivable,'coverage',coverage,
  'event_count',total,'change_token',token)::text);
 if _expected_revision is not null and _expected_revision is distinct from revision then
  raise exception 'finance_history_changed' using errcode='40001';end if;
 with selected as materialized(
  select v.*,finance_private.receivable_history_snapshot(v.old_data,v.old_payer_snapshot,_tenant) b,
   finance_private.receivable_history_snapshot(v.new_data,v.new_payer_snapshot,_tenant) a
  from finance_private.receivable_temporal_versions v where v.tenant_id=_tenant and (_receivable is null or v.receivable_id=_receivable)
  order by v.event_order desc limit 50 offset ((_page::bigint-1)*50)
 ) select coalesce(jsonb_agg(jsonb_build_object('event_order',event_order::text,'receivable_id',receivable_id,'operation',operation,
  'captured_at',captured_at,'transaction_id',transaction_id::text,'actor_id',actor_id,'actor_name',actor_name,'actor_kind',actor_kind,
  'before',b,'after',a,'changed_fields',(select coalesce(jsonb_agg(k order by k),'[]') from unnest(array[
  'description','invoice_number','status','due_date','amount_cents','received_cents','client_id','payer','source','issues']) k where b->k is distinct from a->k))
 order by event_order desc),'[]') into rows from selected;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'receivable_id',_receivable,'basis','captured_versions',
  'captured_at',statement_timestamp(),'revision',revision,'coverage',coverage,'page',_page,'page_size',50,'total',total,'rows',rows,
  'limitations',jsonb_build_array('capture_time_is_not_commit_time','sequence_order_is_not_commit_order','pre_baseline_history_not_certified',
  'not_a_historical_balance','payer_name_at_capture_only'));
end$$;

do $$
declare definition text:=pg_get_functiondef('finance_private.receivable_captured_history(uuid,uuid,integer,text)'::regprocedure);
begin
 if definition ilike '%string_agg%' or definition not ilike '%receivable_history_revisions%' then
  raise exception 'receivable_history_revision_not_materialized';
 end if;
end$$;

comment on table finance_private.receivable_history_revisions is
 'Transactionally maintained O(1) revision heads for immutable receivable captured-history scopes.';
