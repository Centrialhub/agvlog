-- Remaining validation, pagination integrity and finance corrections reported in bugs 82-148.

alter table public.employee_contracts add constraint employee_contracts_salary_nonnegative check(base_salary>=0) not valid;
alter table public.employee_contracts add constraint employee_contracts_valid_period check(end_date is null or end_date>=start_date) not valid;
alter table public.vehicles add constraint vehicles_physical_values_nonnegative check(
  coalesce(odometer_km,0)>=0 and coalesce(year_of_manufacture,0)>=0 and coalesce(capacity_ton,0)>=0 and
  coalesce(avg_km_per_liter,0)>=0 and coalesce(max_pallets,0)>=0 and coalesce(max_weight_kg,0)>=0 and
  coalesce(max_volume_m3,0)>=0 and coalesce(tank_capacity_liters,0)>=0 and coalesce(speed_limit_kmh,0)>=0
) not valid;
alter table public.incidents add constraint incidents_costs_nonnegative check(coalesce(estimated_cost,0)>=0 and coalesce(actual_cost,0)>=0) not valid;
alter table public.route_templates add constraint route_templates_monitor_values check(coalesce(allowed_outside_minutes,0)>=0 and coalesce(route_speed_limit_kmh,0)>=0) not valid;
alter table public.route_waypoints add constraint route_waypoints_duration_nonnegative check(coalesce(estimated_duration_min,0)>=0) not valid;
alter table public.merchandise_shortage_items add constraint shortage_item_quantity_positive check(quantity>0) not valid;
alter table public.merchandise_shortage_items add constraint shortage_item_values_nonnegative check(coalesce(unit_cost,0)>=0 and coalesce(total_amount,0)>=0) not valid;
alter table public.freight_tables add constraint freight_table_valid_period check(valid_until is null or valid_until>=valid_from) not valid;
alter table public.freight_tables add constraint freight_table_values_nonnegative check(
  coalesce(rate_percent,0)>=0 and coalesce(fixed_value,0)>=0 and coalesce(min_value,0)>=0 and coalesce(per_kg_value,0)>=0 and
  coalesce(per_pallet_value,0)>=0 and coalesce(dispatch_value,0)>=0 and coalesce(tracking_value,0)>=0 and coalesce(toll_value,0)>=0 and
  coalesce(loading_value,0)>=0 and coalesce(gris_value,0)>=0 and coalesce(insurance_percent,0)>=0
) not valid;

create or replace function public.guard_reported_catalog_values() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='operational_routes' then
    new.name:=btrim(new.name);
    if new.name='' then raise exception 'route_name_required';end if;
    if new.active and (jsonb_typeof(new.destinations)<>'array' or jsonb_array_length(new.destinations)=0) then raise exception 'active_route_requires_destination';end if;
    if exists(select 1 from public.operational_routes r where r.tenant_id=new.tenant_id and r.id<>new.id and r.active and upper(btrim(r.name))=upper(new.name)) then raise exception 'duplicate_active_route_name';end if;
  elsif tg_table_name='client_regions' then
    new.municipality:=btrim(regexp_replace(new.municipality,'\s+',' ','g'));
    new.region_name:=btrim(regexp_replace(new.region_name,'\s+',' ','g'));
    new.payer_group:=nullif(btrim(regexp_replace(coalesce(new.payer_group,''),'\s+',' ','g')),'');
    if new.municipality='' or new.region_name='' then raise exception 'region_fields_required';end if;
  end if;
  return new;
end$$;
drop trigger if exists reported_operational_route_values on public.operational_routes;
create trigger reported_operational_route_values before insert or update on public.operational_routes for each row execute function public.guard_reported_catalog_values();
drop trigger if exists reported_client_region_values on public.client_regions;
create trigger reported_client_region_values before insert or update on public.client_regions for each row execute function public.guard_reported_catalog_values();

create or replace function public.guard_shortage_status_values() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='charged' and coalesce(new.amount_to_charge,0)<=0 then raise exception 'positive_amount_to_charge_required';end if;
  if new.status='reimbursed' and coalesce(new.amount_reimbursed,0)<=0 then raise exception 'positive_amount_reimbursed_required';end if;
  if new.status='written_off' and coalesce(new.amount_written_off,0)<=0 then raise exception 'positive_amount_written_off_required';end if;
  if new.status='closed' and new.responsible_party_type='driver' and new.responsible_driver_id is null then raise exception 'responsible_driver_required';end if;
  if new.status='closed' and new.responsible_party_type='supplier' and new.responsible_supplier_id is null then raise exception 'responsible_supplier_required';end if;
  return new;
end$$;
drop trigger if exists reported_shortage_status_values on public.merchandise_shortage_cases;
create trigger reported_shortage_status_values before insert or update on public.merchandise_shortage_cases for each row execute function public.guard_shortage_status_values();

create or replace function public.guard_freight_table_overlap() returns trigger language plpgsql set search_path='' as $$
begin
  if not new.blocked and exists(select 1 from public.freight_tables f where f.tenant_id=new.tenant_id and f.id<>new.id and not f.blocked
    and f.client_id is not distinct from new.client_id and f.payer_group is not distinct from new.payer_group and f.payer is not distinct from new.payer
    and f.origin_state is not distinct from new.origin_state and f.destination_state is not distinct from new.destination_state
    and f.origin_municipality is not distinct from new.origin_municipality and f.destination_municipality is not distinct from new.destination_municipality
    and f.origin_region is not distinct from new.origin_region and f.destination_region is not distinct from new.destination_region
    and f.route is not distinct from new.route and f.distribution_type is not distinct from new.distribution_type and f.cargo_type is not distinct from new.cargo_type
    and f.vehicle_type is not distinct from new.vehicle_type and f.body_type is not distinct from new.body_type and f.ctrc_type is not distinct from new.ctrc_type
    and daterange(f.valid_from,coalesce(f.valid_until,'infinity'::date),'[]') && daterange(new.valid_from,coalesce(new.valid_until,'infinity'::date),'[]'))
  then raise exception 'overlapping_freight_table_context';end if;
  return new;
end$$;
drop trigger if exists reported_freight_table_overlap on public.freight_tables;
create trigger reported_freight_table_overlap before insert or update on public.freight_tables for each row execute function public.guard_freight_table_overlap();

-- Bank legacy readers must stay scoped to the selected account and dated obligations.
do $$declare d text;sig regprocedure;begin
 sig:=to_regprocedure('finance_private.legacy_reconciliation_summary(uuid,uuid,date,date)');
 if sig is not null then
  d:=pg_get_functiondef(sig);
  d:=replace(d,'and (o.due_date is null or o.due_date between _period_start and _period_end)','and o.bank_account_id = _bank_account and o.due_date between _period_start and _period_end');
  d:=replace(d,$find$reconciliation_status in ('unmatched', 'suggested')$find$,$replacement$reconciliation_status in ('unmatched', 'suggested', 'manual_review')$replacement$);execute d;
 end if;
 sig:=to_regprocedure('finance_private.legacy_reconciliation_rows(uuid,uuid,date,date,text,text,text,text,text,jsonb)');
 if sig is not null then
  d:=pg_get_functiondef(sig);
  d:=replace(d,'and (o.due_date is null or o.due_date between _period_start and _period_end)','and o.bank_account_id = _bank_account and o.due_date between _period_start and _period_end');execute d;
 end if;
end$$;

-- Account types accepted by the OFX reader, including MONEYMRKT.
alter table public.bank_accounts drop constraint if exists bank_accounts_account_type_check;
alter table public.bank_accounts add constraint bank_accounts_account_type_check check(account_type=any(array['checking','savings','money_market','cash','company_card','pix','other']));
do $$declare d text;begin
 d:=pg_get_functiondef('finance_private.native_statement_account(uuid,uuid)'::regprocedure);
 d:=replace(d,$find$when 'savings' then 'SAVINGS' else null end$find$,$replacement$when 'savings' then 'SAVINGS' when 'money_market' then 'MONEYMRKT' else null end$replacement$);execute d;
end$$;

-- Historical São Paulo OFX files may legitimately use UTC-02 during DST.
do $$declare sig regprocedure;d text;begin
 foreach sig in array array[
  'finance_private.manage_account_opening(jsonb,boolean)'::regprocedure,
  'finance_private.statement_coverage_snapshot(uuid,uuid,date,date)'::regprocedure,
  'finance_private.guard_closed_financial_source()'::regprocedure
 ] loop
  d:=pg_get_functiondef(sig);
  d:=replace(d,$find$is distinct from '-180'$find$,$replacement$not in ('-180','-120')$replacement$);
  execute d;
 end loop;
end$$;

-- A statement hash is unique per account, not globally across the company.
alter table public.finance_statement_imports drop constraint if exists finance_statement_imports_tenant_id_file_hash_key;
create unique index if not exists finance_statement_imports_account_hash on public.finance_statement_imports(tenant_id,bank_account_id,file_hash);
do $$declare sig regprocedure;d text;begin
 foreach sig in array array['finance_private.intake_statement(jsonb)'::regprocedure,'finance_private.intake_statement_artifact(jsonb)'::regprocedure] loop
  d:=pg_get_functiondef(sig);
  d:=replace(d,'where tenant_id=t and file_hash=hash','where tenant_id=t and bank_account_id=account and file_hash=hash');
  d:=replace(d,'where id=account and tenant_id=t and active for share','where id=account and tenant_id=t and active and account_type<>''cash'' for share');
  execute d;
 end loop;
end$$;

-- Controlled reassignment: only the account FK may change; audit history is appended.
create or replace function finance_private.guard_statement_account_reassignment() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op<>'UPDATE' or (to_jsonb(new)-'bank_account_id') is distinct from (to_jsonb(old)-'bank_account_id') then raise exception 'finance_immutable_record' using errcode='55000';end if;
 return new;
end$$;
drop trigger if exists finance_immutable on public.finance_statement_imports;
create trigger finance_immutable before update or delete on public.finance_statement_imports for each row execute function finance_private.guard_statement_account_reassignment();
drop trigger if exists finance_immutable on public.finance_bank_entries;
create trigger finance_immutable before update or delete on public.finance_bank_entries for each row execute function finance_private.guard_statement_account_reassignment();

create or replace function public.reassign_finance_statement_account_v1(_tenant_id uuid,_import_id uuid,_account_id uuid,_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.finance_statement_imports%rowtype;old_account uuid;entry_ids uuid[];actor_name text;
begin
 perform finance_private.require_access(_tenant_id);
 if length(btrim(coalesce(_reason,'')))<10 then raise exception 'reason_required';end if;
 perform pg_advisory_xact_lock(hashtextextended(_tenant_id::text||':finance',0));
 select * into s from public.finance_statement_imports where tenant_id=_tenant_id and id=_import_id for update;
 if not found then raise exception 'statement_not_found';end if; old_account:=s.bank_account_id;
 if not exists(select 1 from public.bank_accounts where tenant_id=_tenant_id and id=_account_id and active and account_type<>'cash') then raise exception 'invalid_target_account';end if;
 select array_agg(id) into entry_ids from public.finance_bank_entries where tenant_id=_tenant_id and first_import_id=_import_id;
 if exists(select 1 from public.finance_reconciliation_groups where tenant_id=_tenant_id and bank_entry_ids && coalesce(entry_ids,'{}'::uuid[])) then raise exception 'statement_already_reconciled';end if;
 if exists(select 1 from public.finance_statement_identity_reviews r join public.finance_statement_rows sr on sr.tenant_id=r.tenant_id and sr.id=r.row_id where sr.import_id=_import_id) then raise exception 'statement_identity_review_exists';end if;
 update public.finance_statement_imports set bank_account_id=_account_id where tenant_id=_tenant_id and id=_import_id;
 update public.finance_bank_entries set bank_account_id=_account_id where tenant_id=_tenant_id and first_import_id=_import_id;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,auth.uid()::text) into actor_name from auth.users where id=auth.uid();
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(_tenant_id,'finance_statement_import',_import_id,'statement_account_reassigned',auth.uid(),coalesce(actor_name,auth.uid()::text),btrim(_reason),
   jsonb_build_object('bank_account_id',old_account),jsonb_build_object('bank_account_id',_account_id));
 return jsonb_build_object('confirmed',true,'import_id',_import_id,'bank_account_id',_account_id);
end$$;
revoke all on function public.reassign_finance_statement_account_v1(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.reassign_finance_statement_account_v1(uuid,uuid,uuid,text) to authenticated;

-- Resolve the true quarantined original rather than the validated JSON derivative.
create or replace function secure_upload_private.can_read_statement_original(_path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from secure_upload_private.artifacts a where a.original_path=_path and a.tenant_id=private.request_tenant_id() and finance_private.can_access(a.tenant_id));
$$;
revoke all on function secure_upload_private.can_read_statement_original(text) from public,anon;
grant execute on function secure_upload_private.can_read_statement_original(text) to authenticated;
drop policy if exists finance_statement_quarantine_original_read on storage.objects;
create policy finance_statement_quarantine_original_read on storage.objects for select to authenticated using(bucket_id='upload-quarantine' and secure_upload_private.can_read_statement_original(name));
create or replace function public.get_finance_statement_original_locator_v1(_tenant_id uuid,_import_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p text;begin perform finance_private.require_access(_tenant_id);
 select a.original_path into p from public.finance_statement_imports s join secure_upload_private.artifacts a on a.id=(s.source_snapshot#>>'{artifact,artifact_id}')::uuid
 where s.tenant_id=_tenant_id and s.id=_import_id and a.tenant_id=_tenant_id;
 if p is null then raise exception 'statement_original_unavailable';end if;
 return jsonb_build_object('bucket','upload-quarantine','path',p);
end$$;
revoke all on function public.get_finance_statement_original_locator_v1(uuid,uuid) from public,anon;
grant execute on function public.get_finance_statement_original_locator_v1(uuid,uuid) to authenticated;
