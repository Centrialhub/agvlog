alter table finance_private.customer_credit_refund_reversals
  add column if not exists request_id uuid,
  add column if not exists payload_hash text;

alter table finance_private.customer_credit_refund_reversals
  drop constraint if exists customer_credit_refund_reversal_request_pair;
alter table finance_private.customer_credit_refund_reversals
  add constraint customer_credit_refund_reversal_request_pair
  check ((request_id is null)=(payload_hash is null));

create unique index if not exists customer_credit_refund_reversal_request_uidx
on finance_private.customer_credit_refund_reversals(tenant_id,request_id)
where request_id is not null;

create or replace function public.reverse_finance_customer_credit_refund_v1(
  _tenant_id uuid,
  _refund_id uuid,
  _reason text,
  _request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  refund finance_private.customer_credit_refunds%rowtype;
  reversal finance_private.customer_credit_refund_reversals%rowtype;
  reversal_id uuid:=gen_random_uuid();
  actor_name text;
  payload_hash text;
begin
  perform finance_private.require_access(_tenant_id);
  if not coalesce(public.is_tenant_admin(_tenant_id),false) then
    raise exception 'finance_admin_required' using errcode='42501';
  end if;
  if _request_id is null or length(btrim(coalesce(_reason,'')))<5 then
    raise exception 'refund_reversal_invalid' using errcode='22023';
  end if;

  payload_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'tenant_id',_tenant_id,
    'refund_id',_refund_id,
    'reason',btrim(_reason),
    'actor_id',auth.uid()
  )::text,'UTF8'),'sha256'),'hex');

  perform pg_advisory_xact_lock(hashtextextended(_tenant_id::text||':finance',0));
  select *
    into reversal
  from finance_private.customer_credit_refund_reversals
  where tenant_id=_tenant_id and request_id=_request_id;
  if found then
    if reversal.refund_id is distinct from _refund_id
       or reversal.payload_hash is distinct from payload_hash then
      raise exception 'refund_reversal_request_conflict' using errcode='23505';
    end if;
    return jsonb_build_object(
      'confirmed',true,
      'request_id',_request_id,
      'reversal_id',reversal.id,
      'refund_id',reversal.refund_id,
      'actor_id',reversal.actor_id,
      'replayed',true
    );
  end if;

  select *
    into refund
  from finance_private.customer_credit_refunds
  where tenant_id=_tenant_id and id=_refund_id
  for update;
  if not found or exists(
    select 1
    from finance_private.customer_credit_refund_reversals existing
    where existing.refund_id=refund.id
  ) then
    raise exception 'refund_reversal_unavailable' using errcode='55000';
  end if;

  select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,auth.uid()::text)
    into actor_name
  from auth.users
  where id=auth.uid();

  insert into finance_private.customer_credit_refund_reversals(
    id,tenant_id,refund_id,actor_id,actor_name,reason,request_id,payload_hash
  ) values (
    reversal_id,_tenant_id,refund.id,auth.uid(),coalesce(actor_name,auth.uid()::text),
    btrim(_reason),_request_id,payload_hash
  );
  insert into public.finance_events(
    tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data
  ) values (
    _tenant_id,'customer_credit',refund.credit_id,'customer_credit_refund_reversed',
    auth.uid(),coalesce(actor_name,auth.uid()::text),btrim(_reason),refund.result,
    jsonb_build_object('reversal_id',reversal_id,'refund_id',refund.id,'request_id',_request_id,'manual_intervention',true)
  );
  return jsonb_build_object(
    'confirmed',true,
    'request_id',_request_id,
    'reversal_id',reversal_id,
    'refund_id',refund.id,
    'actor_id',auth.uid(),
    'replayed',false
  );
end;
$function$;

revoke all on function public.reverse_finance_customer_credit_refund_v1(uuid,uuid,text,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.reverse_finance_customer_credit_refund_v1(uuid,uuid,text,uuid)
to authenticated;
drop function if exists public.reverse_finance_customer_credit_refund_v1(uuid,uuid,text);
