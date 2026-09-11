-- Counted physical cash is an opening position, never a receipt or bank proof.
alter table public.finance_account_openings add column evidence_type text not null default 'bank_statement_v1'
 check(evidence_type in('bank_statement_v1','cash_count_v1'));

create function finance_private.cash_count_total(_counts jsonb) returns bigint
language plpgsql immutable set search_path='' as $$
declare item jsonb;denomination bigint;quantity bigint;total numeric:=0;seen bigint[]:='{}';begin
 if jsonb_typeof(_counts) is distinct from 'array' then raise exception 'finance_invalid_cash_counts' using errcode='22023';end if;
 if jsonb_array_length(_counts) not between 1 and 13 then raise exception 'finance_invalid_cash_counts' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(_counts) loop
  if jsonb_typeof(item) is distinct from 'object' then raise exception 'finance_invalid_cash_counts' using errcode='22023';end if;
  if jsonb_typeof(item->'denomination_cents') is distinct from 'number' or jsonb_typeof(item->'quantity') is distinct from 'number'
   or coalesce(item->>'denomination_cents','') !~ '^[0-9]{1,5}$' or coalesce(item->>'quantity','') !~ '^[0-9]{1,9}$'
   or exists(select 1 from jsonb_object_keys(item) k where k not in('denomination_cents','quantity')) then
   raise exception 'finance_invalid_cash_counts' using errcode='22023';end if;
  denomination:=(item->>'denomination_cents')::bigint;quantity:=(item->>'quantity')::bigint;
  if denomination<>all(array[1,5,10,25,50,100,200,500,1000,2000,5000,10000,20000]::bigint[]) or denomination=any(seen) then
   raise exception 'finance_invalid_cash_counts' using errcode='22023';end if;
  seen:=array_append(seen,denomination);total:=total+denomination*quantity;
 end loop;
 if total>99999999999999 then raise exception 'finance_cash_count_limit' using errcode='22023';end if;
 return total::bigint;
end$$;
revoke all on function finance_private.cash_count_total(jsonb) from public,anon,authenticated,service_role;

create function finance_private.cash_opening_evidence_valid(_evidence jsonb,_date date,_cents bigint) returns boolean
language plpgsql immutable set search_path='' as $$begin
 return coalesce(_evidence->'version'='1'::jsonb and _evidence->>'type'='cash_count_v1'
  and _evidence->>'currency'='BRL' and _evidence->>'timezone'='America/Sao_Paulo'
  and _evidence->>'counted_at_boundary'='start_of_day' and _evidence->>'effective_from'=_date::text
  and jsonb_typeof(_evidence->'custodian_name')='string' and length(btrim(_evidence->>'custodian_name')) between 2 and 200
  and _evidence->>'total_cents'=_cents::text and _cents>=0 and finance_private.cash_count_total(_evidence->'counts')=_cents,false);
exception when sqlstate '22023' then return false;end$$;
revoke all on function finance_private.cash_opening_evidence_valid(jsonb,date,bigint) from public,anon,authenticated,service_role;

create function finance_private.check_cash_opening_evidence() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.evidence_type='cash_count_v1' and (not finance_private.cash_opening_evidence_valid(new.evidence,new.effective_from,new.balance_cents)
  or new.evidence_to<>new.effective_from or not exists(select 1 from public.bank_accounts where tenant_id=new.tenant_id and id=new.bank_account_id and account_type='cash')) then
  raise exception 'finance_invalid_cash_opening_evidence' using errcode='23514';end if;
 return new;
end$$;
revoke all on function finance_private.check_cash_opening_evidence() from public,anon,authenticated,service_role;
create trigger finance_cash_opening_evidence before insert on public.finance_account_openings for each row execute function finance_private.check_cash_opening_evidence();

create function finance_private.record_cash_opening(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();actor_name text;account uuid;starts date;custodian text;
 total bigint;counts jsonb;evidence jsonb;opening uuid;result jsonb;prior public.finance_commands%rowtype;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or _payload->'version' is distinct from '1'::jsonb
  or jsonb_typeof(_payload->'reason') is distinct from 'string' or length(btrim(coalesce(_payload->>'reason',''))) not between 10 and 2000
  or jsonb_typeof(_payload->'custodian_name') is distinct from 'string' or length(btrim(coalesce(_payload->>'custodian_name',''))) not between 2 and 200
  or jsonb_typeof(_payload->'effective_from') is distinct from 'string' or coalesce(_payload->>'effective_from','') !~ '^\d{4}-\d{2}-\d{2}$'
  or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','account_id','effective_from','custodian_name','counts','reason')) then
  raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if prior.actor_id<>actor or prior.action<>'record_cash_opening' or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return prior.result;
 end if;
 account:=(_payload->>'account_id')::uuid;starts:=(_payload->>'effective_from')::date;custodian:=btrim(_payload->>'custodian_name');
 if starts>(clock_timestamp() at time zone 'America/Sao_Paulo')::date then raise exception 'finance_invalid_period' using errcode='22023';end if;
 perform id from public.bank_accounts where tenant_id=t and id=account and active and account_type='cash' for share;
 if not found then raise exception 'finance_cash_account_required' using errcode='22023';end if;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 total:=finance_private.cash_count_total(_payload->'counts');
 select jsonb_agg(value order by (value->>'denomination_cents')::integer) into counts from jsonb_array_elements(_payload->'counts');
 evidence:=jsonb_build_object('version',1,'type','cash_count_v1','currency','BRL','effective_from',starts,'timezone','America/Sao_Paulo',
  'counted_at_boundary','start_of_day','custodian_name',custodian,'counts',counts,'total_cents',total::text);
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;
 actor_name:=coalesce(actor_name,actor::text);
 insert into public.finance_account_openings(tenant_id,bank_account_id,effective_from,balance_cents,evidence_to,evidence,evidence_type,actor_id,actor_name,reason)
 values(t,account,starts,total,starts,evidence,'cash_count_v1',actor,actor_name,btrim(_payload->>'reason')) returning id into opening;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'opening_id',opening,'balance_cents',total::text,'evidence_type','cash_count_v1','confirmed',true,'cash_created',false);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 values(t,'account_opening',opening,'cash_opening_recorded',actor,actor_name,btrim(_payload->>'reason'),result||jsonb_build_object('evidence',evidence));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'record_cash_opening',_payload,result);
 return result;
end$$;
revoke all on function finance_private.record_cash_opening(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.record_cash_opening(jsonb) to authenticated;
create function public.record_finance_cash_opening(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.record_cash_opening(_payload)$$;
revoke all on function public.record_finance_cash_opening(jsonb) from public,anon,service_role;
grant execute on function public.record_finance_cash_opening(jsonb) to authenticated;

-- Preserve existing query OID and bank validation. Cash never invokes OFX checks.
do $$declare body text;needle text;replacement text;begin
 select pg_get_functiondef('finance_private.account_opening(uuid,uuid,date,date)'::regprocedure) into body;
 needle:='evidence:=finance_private.statement_period_evidence(_tenant,_account,o.effective_from,o.evidence_to);';
 if position(needle in body)=0 then raise exception 'finance_opening_query_contract_changed';end if;
 body:=replace(body,needle,$patch$if o.evidence_type='cash_count_v1' then
   valid:=finance_private.cash_opening_evidence_valid(o.evidence,o.effective_from,o.balance_cents)
    and exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=_account and account_type='cash');
  else
  evidence:=finance_private.statement_period_evidence(_tenant,_account,o.effective_from,o.evidence_to);$patch$);
 needle:='active:=jsonb_build_object(''id'',o.id,';
 if position(needle in body)=0 then raise exception 'finance_opening_query_contract_changed';end if;
 body:=replace(body,needle,'end if; active:=jsonb_build_object(''evidence_type'',o.evidence_type,''evidence'',case when o.evidence_type=''cash_count_v1'' then o.evidence else jsonb_build_object(''opening_anchors'',o.evidence->''opening_anchors'') end,''id'',o.id,');
 needle:='jsonb_build_object(''id'',a.id,''effective_from''';
 replacement:='jsonb_build_object(''evidence_type'',a.evidence_type,''evidence'',case when a.evidence_type=''cash_count_v1'' then a.evidence else jsonb_build_object(''opening_anchors'',a.evidence->''opening_anchors'') end,''id'',a.id,''effective_from''';
 if position(needle in body)=0 then raise exception 'finance_opening_query_contract_changed';end if;
 execute replace(body,needle,replacement);
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 needle:='''identity_reviewed_manually'',''identity_review_reversed''';
 if position(needle in body)=0 then raise exception 'finance_opening_audit_contract_changed';end if;
 execute replace(body,needle,'''cash_opening_recorded'','||needle);
end$$;
