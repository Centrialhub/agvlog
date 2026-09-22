-- Optional movement classification, preserving historical requests and labels.
alter table public.finance_movements
 add column cost_center_id uuid,
 add column cost_center_name text,
 add constraint finance_movements_cost_center_fkey foreign key(tenant_id,cost_center_id)
  references public.cost_centers(tenant_id,id) on delete restrict,
 add constraint finance_movements_cost_center_snapshot_check check(
  (cost_center_id is null and cost_center_name is null) or
  (cost_center_id is not null and cost_center_name is not null and length(btrim(cost_center_name))>0));
create index finance_movements_cost_center_idx on public.finance_movements(tenant_id,cost_center_id)
 where cost_center_id is not null;
comment on column public.finance_movements.cost_center_name is 'Cost center name at registration, preserved if the catalog is renamed.';
CREATE OR REPLACE FUNCTION finance_private.record_movement(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 t uuid; actor uuid:=auth.uid(); request uuid; existing public.finance_commands%rowtype;
 movement uuid; account uuid; driver uuid; cents bigint; result jsonb; actor_name text; center uuid; center_name text;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then
  raise exception 'finance_invalid_payload' using errcode='22023'; end if;
 t:=(_payload->>'tenant_id')::uuid; request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501'; end if;
 if request is null or _payload->>'version' is distinct from '1'
 or exists(select 1 from jsonb_object_keys(_payload) k where k not in
 ('version','tenant_id','request_id','bank_account_id','direction','nature','amount_cents','occurred_on',
  'description','beneficiary_name','beneficiary_document','driver_id','bank_reference','receipt_path','reason','cost_center_id')) then
  raise exception 'finance_invalid_payload' using errcode='22023'; end if;
 -- Serializes retries and reference checks, including requests with different IDs.
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into existing from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if existing.actor_id<>actor or existing.action<>'record_movement' or existing.payload<>_payload then
   raise exception 'finance_request_conflict' using errcode='23505'; end if;
  return existing.result;
 end if;
 if _payload->>'nature'='transfer' then raise exception 'finance_transfer_pair_required' using errcode='22023';end if;
 if coalesce(_payload->>'amount_cents','') !~ '^[0-9]{1,14}$'
 or length(btrim(coalesce(_payload->>'reason',''))) not between 5 and 2000
 or coalesce(_payload->>'occurred_on','') !~ '^\d{4}-\d{2}-\d{2}$' then
  raise exception 'finance_invalid_payload' using errcode='22023'; end if;
 cents:=(_payload->>'amount_cents')::bigint;
 if cents<=0 or (_payload->>'occurred_on')::date>(clock_timestamp() at time zone 'America/Sao_Paulo')::date then
  raise exception 'finance_invalid_realized_movement' using errcode='22023'; end if;
 account:=(_payload->>'bank_account_id')::uuid; driver:=nullif(_payload->>'driver_id','')::uuid;
 perform 1 from public.bank_accounts where id=account and tenant_id=t and active for share;
 if not found then raise exception 'finance_invalid_account' using errcode='22023'; end if;
 if driver is not null then
  perform 1 from public.drivers where id=driver and tenant_id=t and active for share;
  if not found then raise exception 'finance_invalid_driver' using errcode='22023'; end if;
 end if;
 center:=nullif(_payload->>'cost_center_id','')::uuid;
 if center is not null then
  select c.name into center_name from public.cost_centers c where c.id=center and c.tenant_id=t and c.active for share;
  if not found then raise exception 'finance_invalid_cost_center' using errcode='22023';end if;
 end if;
 if _payload->>'nature'='driver_advance' and (driver is null or _payload->>'direction' is distinct from 'out') then
  raise exception 'finance_invalid_driver_advance' using errcode='22023'; end if;
 if (_payload->>'nature' in ('receipt','customer_advance') and _payload->>'direction' is distinct from 'in')
 or (_payload->>'nature'='payment' and _payload->>'direction' is distinct from 'out') then
  raise exception 'finance_invalid_direction' using errcode='22023';end if;
 if nullif(btrim(_payload->>'receipt_path'),'') is not null and
  ((_payload->>'receipt_path') not like t::text||'/%' or (_payload->>'receipt_path') like '%..%') then
  raise exception 'finance_invalid_receipt_scope' using errcode='22023'; end if;
 if nullif(btrim(_payload->>'bank_reference'),'') is not null and exists(
  select 1 from finance_private.active_movements where tenant_id=t and bank_account_id=account
   and bank_reference=btrim(_payload->>'bank_reference')) then
  raise exception 'finance_reference_already_recorded' using errcode='23505'; end if;
 insert into public.finance_movements(tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,
  description,beneficiary_name,beneficiary_document,driver_id,bank_reference,receipt_path,created_by,cost_center_id,cost_center_name)
 values(t,account,_payload->>'direction',_payload->>'nature',cents,(_payload->>'occurred_on')::date,
  btrim(_payload->>'description'),btrim(_payload->>'beneficiary_name'),nullif(btrim(_payload->>'beneficiary_document'),''),
  driver,nullif(btrim(_payload->>'bank_reference'),''),nullif(btrim(_payload->>'receipt_path'),''),actor,center,center_name)
 returning id into movement;
 select coalesce(u.raw_user_meta_data->>'full_name',u.email,actor::text) into actor_name from auth.users u where u.id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 select t,'movement',movement,'recorded',actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason'),to_jsonb(m)
 from public.finance_movements m where m.id=movement;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'movement_id',movement,'confirmed',true,'cost_center_id',center,'cost_center_name',center_name);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result)
 values(t,request,actor,'record_movement',_payload,result);
 return result;
end;
$function$;

notify pgrst,'reload schema';
