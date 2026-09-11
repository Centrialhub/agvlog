-- Record a settlement payment against existing recorded money only.
-- This command creates neither a bank statement line nor another expense/movement.
create function finance_private.record_settlement_payment(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();sid uuid;mid uuid;cents bigint;paid numeric;debt numeric;amount numeric;
 prior public.finance_commands%rowtype;s public.driver_settlements%rowtype;m public.finance_movements%rowtype;
 account_name text;payment uuid;link uuid;paid_on timestamptz;next_status text;result jsonb;actor_name text;entry record;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _payload->'version' is distinct from '1'::jsonb or request is null
  or jsonb_typeof(_payload->'amount_cents') is distinct from 'number' or coalesce(_payload->>'amount_cents','') !~ '^[0-9]{1,14}$'
  or jsonb_typeof(_payload->'reason') is distinct from 'string' or length(btrim(coalesce(_payload->>'reason',''))) not between 10 and 2000
  or coalesce(_payload->>'method','') not in('pix','ted','cash','other')
  or jsonb_typeof(_payload->'tenant_id') is distinct from 'string' or jsonb_typeof(_payload->'request_id') is distinct from 'string'
  or jsonb_typeof(_payload->'settlement_id') is distinct from 'string' or jsonb_typeof(_payload->'movement_id') is distinct from 'string'
  or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','settlement_id','movement_id','amount_cents','method','reason')) then
  raise exception 'finance_invalid_payload' using errcode='22023';end if;
 cents:=(_payload->>'amount_cents')::bigint;sid:=(_payload->>'settlement_id')::uuid;mid:=(_payload->>'movement_id')::uuid;
 if cents<=0 or cents>99999999999999 or sid is null or mid is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 amount:=cents::numeric/100;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if prior.actor_id<>actor or prior.action<>'record_settlement_payment' or prior.payload<>_payload then
   raise exception 'finance_request_conflict' using errcode='23505';end if;
  return prior.result;
 end if;
 -- Consistent with payroll lifecycle writers: finance -> periods -> settlement -> entries.
 perform id from public.payroll_periods where tenant_id=t order by id for update;
 select * into s from public.driver_settlements where tenant_id=t and id=sid for update;
 if not found then raise exception 'finance_settlement_not_found' using errcode='22023';end if;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if s.driver_id is null or not exists(select 1 from public.drivers where tenant_id=t and id=s.driver_id) then
  raise exception 'finance_settlement_driver_required' using errcode='23514';end if;
 if s.needs_recalculation or s.status not in('approved','paid') then
  raise exception 'finance_settlement_requires_review' using errcode='23514';end if;
 select * into m from public.finance_movements where tenant_id=t and id=mid;
 if not found or m.direction<>'out' or m.nature='transfer' or m.driver_id is distinct from s.driver_id then
  raise exception 'finance_settlement_movement_mismatch' using errcode='23514';end if;
 select name into account_name from public.bank_accounts where tenant_id=t and id=m.bank_account_id for share;
 if not found or nullif(btrim(account_name),'') is null then raise exception 'finance_invalid_account' using errcode='23514';end if;
 paid_on:=(m.occurred_on+time '12:00') at time zone 'America/Sao_Paulo';
 perform id from public.payroll_entries where tenant_id=t order by payroll_period_id,id for update;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if exists(select 1 from public.payroll_entries pe
   join public.payroll_periods pp on pp.tenant_id=t and pp.id=pe.payroll_period_id
   left join public.employees emp on emp.tenant_id=t and emp.id=pe.employee_id
   where pe.tenant_id=t and ((pp.status<>'cancelled' and pe.status<>'cancelled') or exists(select 1 from public.payables paid_title join finance_private.active_payable_payments paid_record on paid_record.tenant_id=t and paid_record.payable_id=paid_title.id where paid_title.tenant_id=t and paid_title.source_table='payroll_entries' and paid_title.source_id=pe.id and paid_record.amount>0))
    and (pp.status not in('draft','calculated') or pe.status not in('draft','calculated')
      or exists(select 1 from public.payroll_entry_items locked_item where locked_item.tenant_id=t and locked_item.payroll_entry_id=pe.id and locked_item.locked))
    and ((m.occurred_on between pp.period_start and pp.period_end and coalesce(pe.driver_id,emp.driver_id)=s.driver_id)
      or exists(select 1 from public.payroll_entry_items pi where pi.tenant_id=t and pi.payroll_entry_id=pe.id
        and ((pi.source_table='driver_settlements' and pi.source_id=s.id)
          or (pi.source_table='driver_settlement_payments' and exists(select 1 from public.driver_settlement_payments old_payment where old_payment.tenant_id=t and old_payment.id=pi.source_id and old_payment.settlement_id=s.id)))))) then
  raise exception 'finance_settlement_locked_in_payroll' using errcode='55000';end if;
 if exists(select pe.employee_id from public.payroll_entries pe
   join public.payroll_periods pp on pp.tenant_id=t and pp.id=pe.payroll_period_id
   left join public.employees emp on emp.tenant_id=t and emp.id=pe.employee_id
   where pe.tenant_id=t and pp.status in('draft','calculated') and pe.status in('draft','calculated')
     and m.occurred_on between pp.period_start and pp.period_end and coalesce(pe.driver_id,emp.driver_id)=s.driver_id
   group by pe.employee_id having count(*)>1) then
  raise exception 'finance_settlement_overlapping_payroll' using errcode='23514';end if;
 debt:=s.driver_payable_amount;
 if debt is null or debt<0 or debt*100>99999999999999 or debt<>trunc(debt,2) or debt::text in('NaN','Infinity','-Infinity') then
  raise exception 'finance_settlement_amount_review' using errcode='23514';end if;
 if exists(select 1 from public.driver_settlement_payments p where p.settlement_id=s.id
    and (p.tenant_id<>t or p.amount is null or p.amount<=0 or p.amount<>trunc(p.amount,2) or p.amount::text in('NaN','Infinity','-Infinity'))) then
  raise exception 'finance_settlement_amount_review' using errcode='23514';end if;
 select coalesce(sum(p.amount),0) into paid from public.driver_settlement_payments p where p.tenant_id=t and p.settlement_id=s.id;
 if paid+amount>debt then raise exception 'finance_settlement_overpaid' using errcode='23514';end if;
 if finance_private.movement_used_cents(t,m.id)+cents>m.amount_cents then raise exception 'finance_movement_overallocated' using errcode='23514';end if;
 insert into public.driver_settlement_payments(tenant_id,settlement_id,amount,payment_method,payment_account,payment_reference,receipt_url,notes,paid_by,paid_at)
 values(t,s.id,amount,_payload->>'method',account_name,m.bank_reference,null,btrim(_payload->>'reason'),actor,paid_on) returning id into payment;
 insert into public.finance_settlement_movement_links(tenant_id,settlement_id,payment_id,movement_id,amount_cents,created_by)
 values(t,s.id,payment,m.id,cents,actor) returning id into link;
 paid:=paid+amount;next_status:=case when paid=debt then 'paid' else 'approved' end;
 update public.driver_settlements set total_paid_amount=paid,payment_balance=debt-paid,status=next_status,
  paid_by=case when next_status='paid' then actor else null end,paid_at=case when next_status='paid' then paid_on else null end,updated_at=clock_timestamp()
 where tenant_id=t and id=s.id;
 for entry in select pe.* from public.payroll_entries pe
   join public.payroll_periods pp on pp.tenant_id=t and pp.id=pe.payroll_period_id
   left join public.employees emp on emp.tenant_id=t and emp.id=pe.employee_id
   where pe.tenant_id=t and pp.status in('draft','calculated') and pe.status in('draft','calculated')
    and m.occurred_on between pp.period_start and pp.period_end and coalesce(pe.driver_id,emp.driver_id)=s.driver_id order by pe.id loop
  insert into public.payroll_entry_items(tenant_id,payroll_period_id,payroll_entry_id,employee_id,driver_id,item_type,nature,description,amount,
    source_table,source_id,source_metadata,competence_date,occurred_at,created_by)
  values(t,entry.payroll_period_id,entry.id,entry.employee_id,s.driver_id,'driver_settlement_payment','already_paid',
   'Pagamento acerto '||to_char(m.occurred_on,'DD/MM/YYYY'),amount,'driver_settlement_payments',payment,
   jsonb_build_object('movement_id',m.id,'settlement_id',s.id,'request_id',request),m.occurred_on,paid_on,actor);
  perform public.recompute_payroll_entry_totals(entry.id);
 end loop;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'payment_id',payment,'settlement_id',s.id,'movement_id',m.id,
  'link_id',link,'amount_cents',cents,'cash_created',false,'confirmed',true);
 select coalesce(u.raw_user_meta_data->>'full_name',u.email,actor::text) into actor_name from auth.users u where u.id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'settlement_payment',payment,'settlement_payment_recorded',actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason'),
  jsonb_build_object('settlement_id',s.id,'total_paid_amount',s.total_paid_amount,'payment_balance',s.payment_balance,'status',s.status),
  result||jsonb_build_object('paid_at',paid_on,'method',_payload->>'method','payment_account',account_name,'payment_reference',m.bank_reference,'receipt_path',m.receipt_path,'total_paid_amount',paid,'payment_balance',debt-paid));
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 values(t,'settlement_payment',payment,'settlement_payment_linked',actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason'),result);
 perform public._log_settlement_event(s.id,'payment_registered',s.status,next_status,btrim(_payload->>'reason'),
  result||jsonb_build_object('amount',amount,'payment_method',_payload->>'method','payment_account',account_name,'payment_reference',m.bank_reference,'paid_at',paid_on,'total_paid_amount',paid,'payment_balance',debt-paid));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'record_settlement_payment',_payload,result);
 return result;
end$$;
revoke all on function finance_private.record_settlement_payment(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.record_settlement_payment(jsonb) to authenticated;
create function public.record_finance_settlement_payment(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.record_settlement_payment(_payload)$$;
revoke all on function public.record_finance_settlement_payment(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_finance_settlement_payment(jsonb) to authenticated;
