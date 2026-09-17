create table finance_private.legacy_integrity_cache_state(
 tenant_id uuid primary key,
 revision text not null check(revision~'^[a-f0-9]{32}$'),
 refreshed_at timestamptz not null default clock_timestamp()
);
create table finance_private.legacy_integrity_cache_rows(
 tenant_id uuid not null,
 revision text not null check(revision~'^[a-f0-9]{32}$'),
 source_table text not null,
 source_id uuid not null,
 account_status text not null,
 issues text[] not null,
 payload jsonb not null,
 primary key(tenant_id,revision,source_table,source_id)
);
create index legacy_integrity_cache_group_page on finance_private.legacy_integrity_cache_rows(tenant_id,revision,account_status,source_table,source_id);
alter table finance_private.legacy_integrity_cache_state enable row level security;
alter table finance_private.legacy_integrity_cache_rows enable row level security;
revoke all on finance_private.legacy_integrity_cache_state,finance_private.legacy_integrity_cache_rows from public,anon,authenticated,service_role;

create function finance_private.legacy_integrity_inventory_revision(_tenant uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare names text[]:=array['receivables_payments','receivable_payment_reversals','payables_payments','driver_settlement_payments','closing_report_payments','load_payments','employee_advances','payroll_entry_items','bank_transactions','receivables','payables','driver_settlements','closing_reports','loads','employees','payroll_entries','payroll_periods','bank_statement_imports','bank_accounts','finance_movements','finance_settlement_movement_links','finance_settlement_link_reversals','finance_payable_movement_links','finance_payable_link_reversals','finance_movement_voids'];name text;n bigint;x text;state text:='legacy-integrity-v2';
begin
 foreach name in array names loop
  if to_regclass('public.'||name) is null then state:=state||':'||name||':missing';continue;end if;
  execute format('select count(*)::bigint,coalesce(max(xmin::text::bigint)::text,'''') from public.%I where tenant_id=$1',name) into n,x using _tenant;
  state:=state||':'||name||':'||n::text||':'||x;
 end loop;
 return md5(state);
end$$;
revoke all on function finance_private.legacy_integrity_inventory_revision(uuid) from public,anon,authenticated,service_role;

create function finance_private.invalidate_legacy_integrity_cache() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 delete from finance_private.legacy_integrity_cache_state where tenant_id=case when tg_op='DELETE' then old.tenant_id else new.tenant_id end;
 if tg_op='UPDATE' and old.tenant_id is distinct from new.tenant_id then delete from finance_private.legacy_integrity_cache_state where tenant_id=old.tenant_id;end if;
 return null;
end$$;
revoke all on function finance_private.invalidate_legacy_integrity_cache() from public,anon,authenticated,service_role;
do $$declare name text;begin
 foreach name in array array['receivables_payments','receivable_payment_reversals','payables_payments','driver_settlement_payments','closing_report_payments','load_payments','employee_advances','payroll_entry_items','bank_transactions','receivables','payables','driver_settlements','closing_reports','loads','employees','payroll_entries','payroll_periods','bank_statement_imports','bank_accounts','finance_movements','finance_settlement_movement_links','finance_settlement_link_reversals','finance_payable_movement_links','finance_payable_link_reversals','finance_movement_voids'] loop
  if to_regclass('public.'||name) is not null then execute format('create trigger invalidate_legacy_integrity_cache after insert or update or delete on public.%I for each row execute function finance_private.invalidate_legacy_integrity_cache()',name);end if;
 end loop;
end$$;

create or replace function finance_private.legacy_integrity_inventory(_tenant uuid,_page integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;current_revision text;cached text;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 current_revision:=finance_private.legacy_integrity_inventory_revision(_tenant);
 select s.revision into cached from finance_private.legacy_integrity_cache_state s where s.tenant_id=_tenant;
 if cached is distinct from current_revision then
  perform pg_advisory_xact_lock(hashtextextended('legacy-integrity:'||_tenant::text,0));
  current_revision:=finance_private.legacy_integrity_inventory_revision(_tenant);
  select s.revision into cached from finance_private.legacy_integrity_cache_state s where s.tenant_id=_tenant;
  if cached is distinct from current_revision then
   delete from finance_private.legacy_integrity_cache_rows where tenant_id=_tenant;
   delete from finance_private.legacy_integrity_cache_state where tenant_id=_tenant;
   insert into finance_private.legacy_integrity_cache_rows(tenant_id,revision,source_table,source_id,account_status,issues,payload)
   select _tenant,current_revision,r.source_table,r.source_id,r.account_status,r.issues,to_jsonb(r) from finance_private.legacy_integrity_rows(_tenant) r;
   insert into finance_private.legacy_integrity_cache_state(tenant_id,revision) values(_tenant,current_revision);
  end if;
 end if;
 with rows as materialized(select * from finance_private.legacy_integrity_cache_rows where tenant_id=_tenant and revision=current_revision),
 identified as(select * from rows where account_status='identified'),unknowns as(select * from rows where account_status<>'identified'),
 ip as(select * from identified order by source_table,source_id limit 30 offset (_page-1)*30),
 up as(select * from unknowns order by source_table,source_id limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'scope','tenant','page',_page,'page_size',30,'total',(select count(*) from rows),
 'counts_by_source',coalesce((select jsonb_object_agg(source_table,n) from(select source_table,count(*) n from rows group by source_table)x),'{}'),
 'counts_by_issue',coalesce((select jsonb_object_agg(issue,n) from(select issue,count(*) n from rows cross join lateral unnest(issues) issue group by issue)x),'{}'),
 'identified_account',jsonb_build_object('total',(select count(*) from identified),'rows',coalesce((select jsonb_agg(payload order by source_table,source_id) from ip),'[]')),
 'unknown_account',jsonb_build_object('scope','tenant','not_additive_across_accounts',true,'total',(select count(*) from unknowns),'rows',coalesce((select jsonb_agg(payload order by source_table,source_id) from up),'[]')),
 'legacy_integration_status','not_reviewed','can_close',false) into result;
 return result;
end$$;
revoke all on function finance_private.legacy_integrity_inventory(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.legacy_integrity_inventory(uuid,integer) to authenticated;

create or replace function public.get_finance_legacy_integrity_inventory(_tenant_id uuid,_page integer default 1)
returns jsonb language sql volatile security invoker set search_path='' as $$select finance_private.legacy_integrity_inventory(_tenant_id,_page)$$;
revoke all on function public.get_finance_legacy_integrity_inventory(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_legacy_integrity_inventory(uuid,integer) to authenticated;
