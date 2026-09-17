-- One recorded outgoing movement may settle several payable titles. Receivables
-- and driver settlements intentionally keep their own financial semantics.
do $dependencies$
begin
  if to_regprocedure('finance_private.can_access(uuid)') is null
    or to_regprocedure('finance_private.lock_active_movement_use(uuid)') is null
    or to_regprocedure('finance_private.available_movement_cents(uuid,uuid,text)') is null
    or to_regprocedure('finance_private.movement_used_cents(uuid,uuid)') is null
    or to_regclass('finance_private.active_movements') is null
    or to_regclass('finance_private.active_payable_payments') is null then
    raise exception 'finance_payable_bulk_dependencies_missing';
  end if;
end
$dependencies$;

create function finance_private.payable_bulk_context(
  _tenant uuid,
  _movement uuid,
  _items jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor uuid := auth.uid();
  movement_record record;
  item jsonb;
  item_count integer;
  title_count integer;
  beneficiary_count integer;
  requested_cents bigint;
  available_cents bigint;
  invalid_titles integer;
  rows jsonb;
  blockers jsonb := '[]'::jsonb;
  snapshot jsonb;
begin
  if not finance_private.can_access(_tenant) then
    raise exception 'finance_access_denied' using errcode = '42501';
  end if;
  if jsonb_typeof(_items) is distinct from 'array' then
    raise exception 'finance_invalid_payload' using errcode = '22023';
  end if;
  item_count := jsonb_array_length(_items);
  if item_count not between 2 and 100 then
    raise exception 'finance_payable_bulk_size_invalid' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(_items)
  loop
    if jsonb_typeof(item) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(item) key where key not in ('payable_id','amount_cents'))
      or coalesce(item->>'payable_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(item->>'amount_cents','') !~ '^[0-9]{1,14}$'
      or (item->>'amount_cents')::bigint <= 0 then
      raise exception 'finance_invalid_payload' using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct value->>'payable_id') from jsonb_array_elements(_items)) <> item_count then
    raise exception 'finance_payable_bulk_duplicate_title' using errcode = '22023';
  end if;

  select m.id,m.bank_account_id,m.occurred_on,m.amount_cents,m.beneficiary_name,
    m.bank_reference,m.description,m.driver_id,b.name as account_name,m.receipt_path
  into movement_record
  from finance_private.active_movements m
  join public.bank_accounts b on b.tenant_id=m.tenant_id and b.id=m.bank_account_id
  where m.tenant_id=_tenant and m.id=_movement and m.direction='out' and m.nature<>'transfer';
  if not found then
    raise exception 'finance_invalid_payment_movement' using errcode = '22023';
  end if;

  with requested as (
    select (value->>'payable_id')::uuid payable_id,(value->>'amount_cents')::bigint requested_cents
    from jsonb_array_elements(_items)
  )
  select count(p.id),count(distinct coalesce(p.supplier_id::text,'name:'||lower(btrim(coalesce(p.supplier_name,'')))))
  into title_count,beneficiary_count
  from requested r
  left join public.payables p on p.tenant_id=_tenant and p.id=r.payable_id;
  if title_count <> item_count then
    raise exception 'finance_payable_not_found' using errcode = '22023';
  end if;
  if beneficiary_count <> 1 then
    raise exception 'finance_payable_bulk_beneficiary_mismatch' using errcode = '22023';
  end if;
  if exists(
    select 1 from jsonb_array_elements(_items) item_row
    join public.payables p on p.tenant_id=_tenant and p.id=(item_row->>'payable_id')::uuid
    where p.driver_id is not null and p.driver_id is distinct from movement_record.driver_id
  ) then
    raise exception 'finance_payment_driver_mismatch' using errcode = '22023';
  end if;

  available_cents := finance_private.available_movement_cents(_tenant,_movement,'out')::bigint;
  with requested as (
    select (value->>'payable_id')::uuid payable_id,(value->>'amount_cents')::bigint requested_cents
    from jsonb_array_elements(_items)
  ), title_rows as (
    select p.id payable_id,p.supplier_id,p.supplier_name,p.description,p.status,p.driver_id,
      r.requested_cents,
      case when p.amount is null or p.amount::text in ('NaN','Infinity','-Infinity')
        or p.amount<>trunc(p.amount,2) or p.amount<0 then null
        else (p.amount*100)::bigint end nominal_cents,
      paid.paid_cents
    from requested r
    join public.payables p on p.tenant_id=_tenant and p.id=r.payable_id
    left join lateral (
      select case when coalesce(sum(payment.amount),0)::text in ('NaN','Infinity','-Infinity')
        or coalesce(sum(payment.amount),0)<>trunc(coalesce(sum(payment.amount),0),2)
        or coalesce(sum(payment.amount),0)<0 then null
        else (coalesce(sum(payment.amount),0)*100)::bigint end paid_cents
      from finance_private.active_payable_payments payment
      where payment.tenant_id=_tenant and payment.payable_id=p.id
    ) paid on true
  ), evaluated as (
    select title_rows.*,case when title_rows.nominal_cents is null or title_rows.paid_cents is null or title_rows.paid_cents>title_rows.nominal_cents then null
      else title_rows.nominal_cents-title_rows.paid_cents end remaining_cents,
      case when title_rows.status not in ('approved','partial') then 'finance_payable_not_payable'
        when title_rows.nominal_cents is null or title_rows.paid_cents is null or title_rows.paid_cents>title_rows.nominal_cents then 'finance_payable_balance_inconsistent'
        when title_rows.requested_cents>title_rows.nominal_cents-title_rows.paid_cents then 'finance_payable_overpaid'
        else null end issue
    from title_rows
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'payable_id',payable_id,'supplier_id',supplier_id,'supplier_name',supplier_name,
      'description',description,'status',status,'driver_id',driver_id,
      'nominal_cents',nominal_cents::text,'paid_cents',paid_cents::text,
      'remaining_cents',evaluated.remaining_cents::text,'amount_cents',evaluated.requested_cents::text,
      'eligible',issue is null,'issue',issue
    ) order by payable_id),'[]'::jsonb),
    coalesce(sum(evaluated.requested_cents),0)::bigint,
    count(*) filter(where issue is not null)
  into rows,requested_cents,invalid_titles
  from evaluated;

  if invalid_titles>0 then blockers:=blockers||jsonb_build_array('finance_payable_bulk_title_invalid');end if;
  if requested_cents>available_cents then blockers:=blockers||jsonb_build_array('finance_movement_overallocated');end if;
  snapshot:=jsonb_build_object(
    'version',1,'tenant_id',_tenant,'actor_id',actor,
    'movement',jsonb_build_object(
      'id',movement_record.id,'bank_account_id',movement_record.bank_account_id,
      'account_name',movement_record.account_name,'occurred_on',movement_record.occurred_on,
      'beneficiary_name',movement_record.beneficiary_name,'bank_reference',movement_record.bank_reference,
      'description',movement_record.description,'receipt_path',movement_record.receipt_path,
      'amount_cents',movement_record.amount_cents::text,'remaining_cents',available_cents::text
    ),
    'items',rows,'total_cents',requested_cents::text,'blockers',blockers,
    'eligible',jsonb_array_length(blockers)=0
  );
  return snapshot||jsonb_build_object('expected_revision',md5(snapshot::text));
end
$function$;
revoke all on function finance_private.payable_bulk_context(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.payable_bulk_context(uuid,uuid,jsonb) to authenticated;

create function public.get_finance_payable_bulk_context(
  _tenant_id uuid,
  _movement_id uuid,
  _items jsonb
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select finance_private.payable_bulk_context(_tenant_id,_movement_id,_items);
$function$;
revoke all on function public.get_finance_payable_bulk_context(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_payable_bulk_context(uuid,uuid,jsonb) to authenticated;

create function finance_private.apply_payable_bulk_movement(_payload jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  t uuid;
  actor uuid := auth.uid();
  request uuid;
  movement_id uuid;
  account_id uuid;
  old_command public.finance_commands%rowtype;
  context jsonb;
  item jsonb;
  payment_id uuid;
  link_id uuid;
  result_rows jsonb := '[]'::jsonb;
  result jsonb;
  actor_name text;
begin
  if jsonb_typeof(_payload) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(_payload) key where key not in (
      'version','tenant_id','request_id','movement_id','bank_account_id','paid_on',
      'expected_revision','items','method','reason'
    ))
    or _payload->>'version' is distinct from '1'
    or coalesce(_payload->>'expected_revision','') !~ '^[0-9a-f]{32}$'
    or coalesce(_payload->>'paid_on','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(_payload->>'method','') not in ('pix','boleto','ted','doc','dinheiro','cartao','debito_automatico','other')
    or length(btrim(coalesce(_payload->>'reason',''))) not between 5 and 2000
    or jsonb_typeof(_payload->'items') is distinct from 'array'
    or jsonb_array_length(_payload->'items') not between 2 and 100 then
    raise exception 'finance_invalid_payload' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(_payload->'items')
  loop
    if jsonb_typeof(item) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(item) key where key not in ('payable_id','amount_cents'))
      or coalesce(item->>'payable_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(item->>'amount_cents','') !~ '^[0-9]{1,14}$'
      or (item->>'amount_cents')::bigint <= 0 then
      raise exception 'finance_invalid_payload' using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct value->>'payable_id') from jsonb_array_elements(_payload->'items'))
      <> jsonb_array_length(_payload->'items') then
    raise exception 'finance_payable_bulk_duplicate_title' using errcode = '22023';
  end if;

  t:=(_payload->>'tenant_id')::uuid;
  request:=(_payload->>'request_id')::uuid;
  movement_id:=(_payload->>'movement_id')::uuid;
  account_id:=(_payload->>'bank_account_id')::uuid;
  if not finance_private.can_access(t) then
    raise exception 'finance_access_denied' using errcode = '42501';
  end if;

  -- The same tenant-level lock is used by all canonical outgoing allocation
  -- writers. It also reauthorizes after a wait and rejects a busy request.
  perform finance_private.lock_active_movement_use(t);
  if not finance_private.can_access(t) then
    raise exception 'finance_access_denied' using errcode = '42501';
  end if;
  select * into old_command from public.finance_commands where tenant_id=t and request_id=request;
  if found then
    if old_command.actor_id<>actor or old_command.action<>'apply_payable_bulk_movement' or old_command.payload<>_payload then
      raise exception 'finance_request_conflict' using errcode = '23505';
    end if;
    return old_command.result;
  end if;

  -- Lock titles in a deterministic order. Missing or foreign titles are
  -- rejected by the context without exposing their data.
  perform 1
  from public.payables p
  join (
    select (value->>'payable_id')::uuid payable_id
    from jsonb_array_elements(_payload->'items')
  ) requested on requested.payable_id=p.id
  where p.tenant_id=t
  order by p.id
  for update of p;
  if not finance_private.can_access(t) then
    raise exception 'finance_access_denied' using errcode = '42501';
  end if;

  context:=finance_private.payable_bulk_context(t,movement_id,_payload->'items');
  if context->>'expected_revision' is distinct from _payload->>'expected_revision' then
    raise exception 'finance_payable_bulk_changed' using errcode = '40001';
  end if;
  if coalesce((context->>'eligible')::boolean,false) is not true then
    raise exception 'finance_payable_bulk_not_eligible' using errcode = '55000';
  end if;
  if context#>>'{movement,bank_account_id}' is distinct from account_id::text
    or context#>>'{movement,occurred_on}' is distinct from _payload->>'paid_on' then
    raise exception 'finance_payable_bulk_movement_changed' using errcode = '40001';
  end if;

  select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text)
  into actor_name from auth.users where id=actor;
  for item in
    select value from jsonb_array_elements(_payload->'items') order by value->>'payable_id'
  loop
    insert into public.payables_payments(
      tenant_id,payable_id,amount,paid_at,bank_account_id,method,notes,
      attachment_url,bank_transaction_id,created_by
    ) values(
      t,(item->>'payable_id')::uuid,(item->>'amount_cents')::bigint::numeric/100,
      ((_payload->>'paid_on')::date+time '12:00') at time zone 'America/Sao_Paulo',
      account_id,_payload->>'method',btrim(_payload->>'reason'),
      context#>>'{movement,receipt_path}',null,actor
    ) returning id into payment_id;
    insert into public.finance_payable_movement_links(
      tenant_id,movement_id,payable_id,payment_id,amount_cents,created_by
    ) values(
      t,movement_id,(item->>'payable_id')::uuid,payment_id,(item->>'amount_cents')::bigint,actor
    ) returning id into link_id;
    result_rows:=result_rows||jsonb_build_array(jsonb_build_object(
      'payable_id',item->>'payable_id','payment_id',payment_id,'link_id',link_id,
      'amount_cents',item->>'amount_cents'
    ));
    insert into public.finance_events(
      tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data
    ) values(
      t,'payable_payment',payment_id,'payable_bulk_movement_applied',actor,
      coalesce(actor_name,actor::text),btrim(_payload->>'reason'),
      jsonb_build_object('request_id',request,'movement_id',movement_id,'bank_account_id',account_id,
        'paid_on',_payload->>'paid_on','payable_id',item->>'payable_id',
        'amount_cents',item->>'amount_cents','manual_intervention',true)
    );
  end loop;

  result:=jsonb_build_object(
    'version',1,'tenant_id',t,'actor_id',actor,'request_id',request,
    'movement_id',movement_id,'bank_account_id',account_id,'paid_on',_payload->>'paid_on',
    'total_cents',context->>'total_cents','rows',result_rows,
    'bank_confirmation','not_evaluated','cash_created',false,'confirmed',true
  );
  insert into public.finance_events(
    tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data
  ) values(
    t,'payable_payment_batch',request,'payable_bulk_movement_confirmed',actor,
    coalesce(actor_name,actor::text),btrim(_payload->>'reason'),
    result||jsonb_build_object('expected_revision',_payload->>'expected_revision','manual_intervention',true)
  );
  insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result)
  values(t,request,actor,'apply_payable_bulk_movement',_payload,result);
  return result;
end
$function$;
revoke all on function finance_private.apply_payable_bulk_movement(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.apply_payable_bulk_movement(jsonb) to authenticated;

create function public.apply_finance_payable_bulk_movement(_payload jsonb) returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select finance_private.apply_payable_bulk_movement(_payload);
$function$;
revoke all on function public.apply_finance_payable_bulk_movement(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.apply_finance_payable_bulk_movement(jsonb) to authenticated;
