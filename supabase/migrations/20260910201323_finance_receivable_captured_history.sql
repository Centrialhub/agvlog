-- A journal of captured versions; neither an as_of balance nor commit history.
create function finance_private.receivable_history_snapshot(_data jsonb,_payer jsonb,_tenant uuid)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;issues text[]:='{}';amount text;received text;due date;client uuid;source jsonb:='{}';key text;value text;id uuid;payer jsonb;
begin
 if _data is null then return null;end if;
 value:=_data->>'amount';
 if value ~ '^[0-9]+(\.[0-9]+)?$' and length(value)<=100 then
  if value::numeric*100=trunc(value::numeric*100) then amount:=trunc(value::numeric*100)::text;end if;
 end if;
 if amount is null then issues:=array_append(issues,'amount_invalid');end if;
 value:=_data->>'received_amount';
 if value is null then issues:=array_append(issues,'received_amount_unknown');
 else
  if value ~ '^[0-9]+(\.[0-9]+)?$' and length(value)<=100 then
   if value::numeric*100=trunc(value::numeric*100) then received:=trunc(value::numeric*100)::text;end if;
  end if;
  if received is null then issues:=array_append(issues,'received_amount_invalid');end if;
 end if;
 value:=_data->>'due_date';
 if value is not null then
  begin
   if value !~ '^\d{4}-\d{2}-\d{2}$' then raise invalid_datetime_format;end if;
   due:=value::date;
   if not isfinite(due) then due:=null;end if;
  exception when invalid_datetime_format or datetime_field_overflow then due:=null;end;
  if due is null then issues:=array_append(issues,'due_date_invalid');end if;
 end if;
 value:=_data->>'client_id';
 if value is not null then
  begin client:=value::uuid;exception when invalid_text_representation then issues:=array_append(issues,'client_id_invalid');end;
 end if;
 foreach key in array array['order_id','fiscal_document_id','load_id','client_invoice_id','closing_report_id'] loop
  value:=_data->>key;id:=null;
  if value is not null then
   begin id:=value::uuid;exception when invalid_text_representation then issues:=array_append(issues,'source_identity_invalid');end;
  end if;
  source:=source||jsonb_build_object(key,id);
 end loop;
 if _payer is not null then
  if jsonb_typeof(_payer)='object' and _payer->>'id'=client::text and _payer->>'tenant_id'=_tenant::text then
   payer:=jsonb_build_object('id',client,'tenant_id',_tenant,'company_name',_payer->>'company_name');
  else issues:=array_append(issues,'payer_snapshot_invalid');end if;
 end if;
 result:=jsonb_build_object('description',_data->>'description','invoice_number',_data->>'invoice_number','status',_data->>'status',
  'due_date',due,'amount_cents',amount,'received_cents',received,'client_id',client,'payer',payer,'source',source,
  'issues',(select coalesce(jsonb_agg(distinct x order by x),'[]') from unnest(issues) x));
 return result;
end$$;
revoke all on function finance_private.receivable_history_snapshot(jsonb,jsonb,uuid) from public,anon,authenticated,service_role;

create function finance_private.receivable_captured_history(_tenant uuid,_receivable uuid,_page integer,_expected_revision text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare coverage jsonb;revision text;total bigint;rows jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page<1 then raise exception 'finance_invalid_history_page' using errcode='22023';end if;
 if _page>1 and _expected_revision is null then raise exception 'finance_history_revision_required' using errcode='22023';end if;
 select jsonb_build_object('starts_at',c.coverage_starts_at,'baseline_kind',c.baseline_kind,'capture_basis',c.capture_basis)
 into coverage from finance_private.receivable_temporal_coverage c where c.tenant_id=_tenant;
 -- Every visible event participates, not max(sequence). A transaction that
 -- commits later with a smaller allocated sequence changes this fingerprint.
 select count(*),md5(jsonb_build_object('version',1,'tenant_id',_tenant,'receivable_id',_receivable,'coverage',coverage,
  'event_content_hash',md5(coalesce(string_agg(md5(to_jsonb(v)::text),'' order by v.event_order),'')))::text)
 into total,revision from finance_private.receivable_temporal_versions v where v.tenant_id=_tenant and (_receivable is null or v.receivable_id=_receivable);
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
revoke all on function finance_private.receivable_captured_history(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.receivable_captured_history(uuid,uuid,integer,text) to authenticated;
create function public.get_finance_receivable_history(_tenant_id uuid,_receivable_id uuid default null,_page integer default 1,_expected_revision text default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select finance_private.receivable_captured_history(_tenant_id,_receivable_id,_page,_expected_revision)
$$;
revoke all on function public.get_finance_receivable_history(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_receivable_history(uuid,uuid,integer,text) to authenticated;
