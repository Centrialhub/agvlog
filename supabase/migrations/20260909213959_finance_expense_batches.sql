create table public.finance_expense_batches (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 context text not null check(context in ('trip','office','personnel','maintenance','other')),
 trip_id uuid references public.dispatch_trips(id),driver_id uuid references public.drivers(id),
 description text not null,created_by uuid not null,created_at timestamptz not null default clock_timestamp(),
 check((context='trip')=(trip_id is not null)),unique(tenant_id,id)
);
create table public.finance_expense_items (
 id uuid primary key,tenant_id uuid not null,batch_id uuid not null,
 category text not null check(category in ('fuel','food','unloading','toll','lodging','maintenance','office','cleaning','payroll','tax','rent','utility','service','other')),
 description text not null check(length(btrim(description)) between 1 and 1000),
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=99999999999999),
 occurred_on date not null,supplier_id uuid references public.clients(id),supplier_name text not null,
 cost_center_id uuid references public.cost_centers(id),document_number text,receipt_path text,no_receipt_reason text,
 payable_id uuid unique references public.payables(id),unloading_id uuid unique references public.finance_unloading_charges(id),
 created_by uuid not null,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id),
 foreign key(tenant_id,batch_id) references public.finance_expense_batches(tenant_id,id),
 check((receipt_path is not null) or coalesce(length(btrim(no_receipt_reason)),0)>=5)
);
create table public.finance_expense_allocations (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,expense_id uuid not null,movement_id uuid not null,
 amount_cents bigint not null check(amount_cents>0),created_by uuid not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,expense_id) references public.finance_expense_items(tenant_id,id),
 foreign key(tenant_id,movement_id) references public.finance_movements(tenant_id,id),
 unique(expense_id,movement_id)
);
create index finance_expense_items_batch on public.finance_expense_items(tenant_id,batch_id);
create index finance_expense_items_category_date on public.finance_expense_items(tenant_id,category,occurred_on);
create index finance_expense_allocations_movement on public.finance_expense_allocations(tenant_id,movement_id);
do $$declare t text;begin
 foreach t in array array['finance_expense_batches','finance_expense_items','finance_expense_allocations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated,service_role',t);
  execute format('create policy finance_read on public.%I for select to authenticated using(finance_private.can_access(tenant_id))',t);
  execute format('create trigger preserve_finance before update or delete on public.%I for each row execute function finance_private.preserve_event()',t);
 end loop;
end;$$;

create function finance_private.record_expense_batch(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid; actor uuid:=auth.uid(); request uuid; trip uuid; driver uuid; batch uuid;
 existing public.finance_commands%rowtype; item jsonb; allocation jsonb; movement public.finance_movements%rowtype;
 cents bigint; allocated bigint; used bigint; linked bigint; expense uuid; payable uuid; unloading uuid;
 supplier uuid; cost_center uuid; supplier_name text; payee_name text; center_name text; actor_name text; result jsonb;
 rows jsonb:='[]'; discharge_result jsonb; context jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;trip:=nullif(_payload->>'trip_id','')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or _payload->>'version' is distinct from '1'
 or coalesce(_payload->>'context','') not in('trip','office','personnel','maintenance','other')
 or ((_payload->>'context'='trip')<>(trip is not null))
 or jsonb_typeof(_payload->'items') is distinct from 'array' or jsonb_array_length(_payload->'items') not between 1 and 200
 or length(btrim(coalesce(_payload->>'reason',''))) not between 5 and 2000
 or length(btrim(coalesce(_payload->>'description',''))) not between 1 and 1000
 or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','context','trip_id','description','reason','items')) then
  raise exception 'finance_invalid_batch' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 select * into existing from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if existing.actor_id<>actor or existing.action<>'record_expense_batch' or existing.payload<>_payload then
   raise exception 'finance_request_conflict' using errcode='23505';end if;return existing.result;
 end if;
 if trip is not null then
  select driver_id into driver from public.dispatch_trips where id=trip and tenant_id=t and status='completed' for share;
  if not found then raise exception 'finance_trip_not_completed' using errcode='22023';end if;
 end if;
 insert into public.finance_expense_batches(tenant_id,context,trip_id,driver_id,description,created_by)
 values(t,_payload->>'context',trip,driver,btrim(_payload->>'description'),actor) returning id into batch;
 for item in select value from jsonb_array_elements(_payload->'items') loop
  expense:=(item->>'id')::uuid; supplier:=nullif(item->>'supplier_id','')::uuid;
  cost_center:=nullif(item->>'cost_center_id','')::uuid;payable:=null;unloading:=null;
  if expense is null or jsonb_typeof(item) is distinct from 'object'
  or coalesce(item->>'amount_cents','') !~ '^[0-9]{1,14}$'
  or coalesce(item->>'occurred_on','') !~ '^\d{4}-\d{2}-\d{2}$'
  or length(btrim(coalesce(item->>'description',''))) not between 1 and 1000
  or jsonb_typeof(item->'allocations') is distinct from 'array' or jsonb_array_length(item->'allocations')>100
  or exists(select 1 from jsonb_object_keys(item) k where k not in('id','category','description','amount_cents','occurred_on',
   'supplier_id','supplier_name','cost_center_id','document_number','receipt_path','no_receipt_reason','due_date','allocations','stop_id','delivery_revision','payee_type')) then
   raise exception 'finance_invalid_expense_item' using errcode='22023';end if;
  cents:=(item->>'amount_cents')::bigint;
  if cents<=0 or (item->>'occurred_on')::date>(clock_timestamp() at time zone 'America/Sao_Paulo')::date then
   raise exception 'finance_invalid_expense_amount_or_date' using errcode='22023';end if;
  if nullif(item->>'receipt_path','') is null then
   if length(btrim(coalesce(item->>'no_receipt_reason','')))<5 then raise exception 'finance_receipt_required' using errcode='22023';end if;
  elsif (item->>'receipt_path') not like t::text||'/%' or (item->>'receipt_path') like '%..%' then
   raise exception 'finance_invalid_receipt_scope' using errcode='22023';end if;
  supplier_name:=btrim(coalesce(item->>'supplier_name',''));
  if supplier is not null then
   select company_name into supplier_name from public.clients where id=supplier and tenant_id=t and active for share;
   if not found then raise exception 'finance_invalid_supplier' using errcode='22023';end if;
  end if;
  if supplier_name='' or supplier_name is null then raise exception 'finance_supplier_name_required' using errcode='22023';end if;
  center_name:=null;
  if cost_center is not null then
   select name into center_name from public.cost_centers where id=cost_center and tenant_id=t and active for share;
   if not found then raise exception 'finance_invalid_cost_center' using errcode='22023';end if;
  end if;
  allocated:=0;
  for allocation in select value from jsonb_array_elements(item->'allocations') loop
   if coalesce(allocation->>'amount_cents','') !~ '^[0-9]{1,14}$' then raise exception 'finance_invalid_allocation' using errcode='22023';end if;
   linked:=(allocation->>'amount_cents')::bigint;
   select * into movement from public.finance_movements where tenant_id=t and id=(allocation->>'movement_id')::uuid for share;
   if not found or movement.direction<>'out' or movement.nature='transfer'
    or (movement.driver_id is not null and movement.driver_id is distinct from driver) then
    raise exception 'finance_invalid_expense_movement' using errcode='22023';end if;
   select coalesce(sum(amount_cents),0) into used from public.finance_expense_allocations where tenant_id=t and movement_id=movement.id;
   if linked<=0 or used+linked>movement.amount_cents then raise exception 'finance_movement_overallocated' using errcode='23514';end if;
   allocated:=allocated+linked;
  end loop;
  if allocated>cents then raise exception 'finance_expense_overallocated' using errcode='23514';end if;
  if item->>'category'='unloading' then
   if trip is null or nullif(item->>'stop_id','') is null then raise exception 'finance_unloading_delivery_required' using errcode='22023';end if;
   context:=finance_private.delivery_context(t,(item->>'stop_id')::uuid);
   if context->>'trip_id' is distinct from trip::text then raise exception 'finance_unloading_trip_mismatch' using errcode='22023';end if;
   discharge_result:=finance_private.record_unloading(jsonb_build_object('version',1,'tenant_id',t,'request_id',expense,
    'stop_id',item->>'stop_id','expected_revision',item->>'delivery_revision','amount_cents',cents,'occurred_on',item->>'occurred_on',
    'due_date',item->>'due_date','receipt_path',item->>'receipt_path','reason',_payload->>'reason'));
   unloading:=(discharge_result->>'charge_id')::uuid;
  end if;
  if allocated<cents then
   if coalesce(item->>'payee_type','') not in('driver','supplier') then
    raise exception 'finance_payee_required' using errcode='22023';end if;
   payee_name:=supplier_name;
   if item->>'payee_type'='driver' then
    select name into payee_name from public.drivers where id=driver and tenant_id=t;
    if not found then raise exception 'finance_invalid_payee' using errcode='22023';end if;
   end if;
   insert into public.payables(tenant_id,supplier_name,supplier_id,category,description,amount,due_date,competence_date,
    status,driver_id,dispatch_trip_id,document_number,receipt_url,created_by,source_table,source_id,cost_center)
   values(t,payee_name,case when item->>'payee_type'='supplier' then supplier end,
    case when item->>'category' in('fuel','toll','maintenance','payroll','tax','rent','service') then item->>'category' else 'other' end,
    item->>'description',(cents-allocated)::numeric/100,
    nullif(item->>'due_date','')::date,(item->>'occurred_on')::date,'pending',driver,trip,
    nullif(item->>'document_number',''),nullif(item->>'receipt_path',''),actor,'finance_expense_items',expense,center_name)
   returning id into payable;
  end if;
  insert into public.finance_expense_items(id,tenant_id,batch_id,category,description,amount_cents,occurred_on,supplier_id,supplier_name,
   cost_center_id,document_number,receipt_path,no_receipt_reason,payable_id,unloading_id,created_by)
  values(expense,t,batch,item->>'category',btrim(item->>'description'),cents,(item->>'occurred_on')::date,supplier,supplier_name,
   cost_center,nullif(item->>'document_number',''),nullif(item->>'receipt_path',''),nullif(item->>'no_receipt_reason',''),payable,unloading,actor);
  for allocation in select value from jsonb_array_elements(item->'allocations') loop
   insert into public.finance_expense_allocations(tenant_id,expense_id,movement_id,amount_cents,created_by)
   values(t,expense,(allocation->>'movement_id')::uuid,(allocation->>'amount_cents')::bigint,actor);
  end loop;
  rows:=rows||jsonb_build_array(jsonb_build_object('expense_id',expense,'payable_id',payable,'unloading_id',unloading));
 end loop;
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 values(t,'expense_batch',batch,'recorded',actor,coalesce(actor_name,actor::text),_payload->>'reason',_payload);
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'batch_id',batch,'rows',rows,'confirmed',true);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result)
 values(t,request,actor,'record_expense_batch',_payload,result);
 return result;
end;
$$;
revoke all on function finance_private.record_expense_batch(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.record_expense_batch(jsonb) to authenticated;
create function public.record_finance_expense_batch(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.record_expense_batch(_payload);$$;
revoke all on function public.record_finance_expense_batch(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_finance_expense_batch(jsonb) to authenticated;
