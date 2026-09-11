create table public.finance_receivable_movement_links(
 tenant_id uuid not null,command_id uuid not null,payment_id uuid not null,bank_transaction_id uuid not null,movement_id uuid not null,
 action text not null check(action in('receive','reverse')),created_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,command_id),unique(tenant_id,bank_transaction_id),
 foreign key(tenant_id,command_id) references public.receivable_financial_commands(tenant_id,id),
 foreign key(tenant_id,payment_id) references public.receivables_payments(tenant_id,id),
 foreign key(tenant_id,bank_transaction_id) references public.bank_transactions(tenant_id,id),
 foreign key(tenant_id,movement_id) references public.finance_movements(tenant_id,id)
);
create index finance_receivable_links_movement on public.finance_receivable_movement_links(tenant_id,movement_id);
alter table public.finance_receivable_movement_links enable row level security;
revoke all on public.finance_receivable_movement_links from public,anon,authenticated,service_role;
grant select on public.finance_receivable_movement_links to authenticated,service_role;
create policy finance_receivable_links_read on public.finance_receivable_movement_links for select to authenticated using(finance_private.can_access(tenant_id));
create trigger finance_receivable_links_immutable before update or delete on public.finance_receivable_movement_links for each row execute function finance_private.preserve_event();

create function finance_private.project_receivable_command() returns trigger
language plpgsql security definer set search_path='' as $$
declare payment public.receivables_payments%rowtype;tx public.bank_transactions%rowtype;reversal public.receivable_payment_reversals%rowtype;
 movement uuid;party text;actor_name text;effective_at timestamptz;amount numeric;receipt text;description text;
 selected public.finance_movements%rowtype;allocated numeric;
begin
 if new.action not in('receive','reverse') then return new;end if;
 if new.actor_id is distinct from auth.uid() or not finance_private.can_access(new.tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into payment from public.receivables_payments where tenant_id=new.tenant_id and receivable_id=new.receivable_id and id=(new.response->>'payment_id')::uuid;
 if not found then raise exception 'finance_receipt_projection_source_missing' using errcode='23514';end if;
 select * into tx from public.bank_transactions where tenant_id=new.tenant_id and id=(new.response->>'bank_transaction_id')::uuid;
 if not found or tx.bank_account_id is distinct from payment.bank_account_id then raise exception 'finance_receipt_projection_bank_mismatch' using errcode='23514';end if;
 if new.action='receive' then
  if payment.financial_command_id is distinct from new.id or payment.bank_transaction_id is distinct from tx.id or tx.transaction_type<>'credit' then raise exception 'finance_receipt_projection_source_mismatch' using errcode='23514';end if;
  effective_at:=payment.received_at;amount:=payment.amount;receipt:=payment.attachment_url;
 else
  select * into reversal from public.receivable_payment_reversals where tenant_id=new.tenant_id and financial_command_id=new.id and payment_id=payment.id and bank_transaction_id=tx.id;
  if not found or tx.transaction_type<>'debit' then raise exception 'finance_receipt_projection_reversal_mismatch' using errcode='23514';end if;
  effective_at:=reversal.effective_at;amount:=reversal.amount;
 end if;
 if amount is null or amount<=0 or amount*100<>trunc(amount*100) or amount*100>99999999999999 or amount is distinct from tx.amount
  or effective_at is distinct from tx.posted_at then raise exception 'finance_receipt_projection_amount_mismatch' using errcode='23514';end if;
 select coalesce(nullif(btrim(to_jsonb(c)->>'company_name'),''),nullif(btrim(to_jsonb(c)->>'name'),'')) into party
  from public.receivables r join public.clients c on c.tenant_id=r.tenant_id and c.id=r.client_id where r.tenant_id=new.tenant_id and r.id=new.receivable_id;
 party:=coalesce(party,'Contraparte não identificada');
 description:=case when new.action='receive' then 'Recebimento registrado: ' else 'Devolução registrada de recebimento: ' end||coalesce(new.before_snapshot->>'reference',new.receivable_id::text);
 if new.action='receive' and new.response ? 'movement_id' then
  select * into selected from public.finance_movements where tenant_id=new.tenant_id and id=(new.response->>'movement_id')::uuid;
  if not found or selected.direction<>'in' or selected.nature not in('receipt','customer_advance','other')
   or selected.bank_account_id<>tx.bank_account_id or selected.occurred_on<>(effective_at at time zone 'America/Sao_Paulo')::date then
   raise exception 'finance_receipt_movement_incompatible' using errcode='23514';end if;
  select coalesce(sum(p.amount*100),0) into allocated from public.finance_receivable_movement_links l
   join public.receivables_payments p on p.tenant_id=l.tenant_id and p.id=l.payment_id
   where l.tenant_id=new.tenant_id and l.movement_id=selected.id and l.action='receive';
  if allocated+amount*100>selected.amount_cents then raise exception 'finance_receipt_movement_capacity_exceeded' using errcode='23514';end if;
  movement:=selected.id;
 else
 insert into public.finance_movements(tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,receipt_path,created_by)
 values(new.tenant_id,tx.bank_account_id,case when new.action='receive' then 'in' else 'out' end,case when new.action='receive' then 'receipt' else 'refund' end,
  (amount*100)::bigint,(effective_at at time zone 'America/Sao_Paulo')::date,left(description,1000),left(party,300),receipt,new.actor_id) returning id into movement;
 end if;
 insert into public.finance_receivable_movement_links(tenant_id,command_id,payment_id,bank_transaction_id,movement_id,action)
 values(new.tenant_id,new.id,payment.id,tx.id,movement,new.action);
 select coalesce(raw_user_meta_data->>'full_name',email,new.actor_id::text) into actor_name from auth.users where id=new.actor_id;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 values(new.tenant_id,'movement',movement,'receivable_movement_recorded',new.actor_id,coalesce(actor_name,new.actor_id::text),new.reason,
  jsonb_build_object('movement_id',movement,'receivable_id',new.receivable_id,'payment_id',payment.id,'command_id',new.id,'legacy_bank_transaction_id',tx.id,'source_action',new.action,'refund_kind',new.response->>'refund_kind','bank_confirmed',false));
 return new;
end;$$;

create function finance_private.receipt_movement_options(_tenant uuid,_account uuid,_date date,_search text,_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _date is null or _page is null or _page not between 1 and 1000000 or _search is null or length(_search)>200 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if not exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=_account) then raise exception 'finance_account_not_found' using errcode='22023';end if;
 with candidates as materialized(
  select m.*,m.amount_cents-coalesce((select sum(p.amount*100) from public.finance_receivable_movement_links l join public.receivables_payments p on p.tenant_id=l.tenant_id and p.id=l.payment_id
    where l.tenant_id=_tenant and l.movement_id=m.id and l.action='receive'),0) available
  from public.finance_movements m where m.tenant_id=_tenant and m.bank_account_id=_account and m.occurred_on=_date and m.direction='in' and m.nature in('receipt','customer_advance','other')
   and (_search='' or strpos(lower(m.description||' '||m.beneficiary_name||' '||coalesce(m.bank_reference,'')),lower(_search))>0)
 ), available as materialized(select * from candidates where available>0),paged as(select * from available order by created_at desc,id desc limit 20 offset (_page-1)*20)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'bank_account_id',_account,'date',_date,'page',_page,'page_size',20,'total',(select count(*) from available),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'description',description,'counterparty',beneficiary_name,'amount_cents',amount_cents::text,'available_cents',available::text,'bank_reference',bank_reference) order by created_at desc,id desc) from paged),'[]')) into result;
 return result;
end;$$;
revoke all on function finance_private.receipt_movement_options(uuid,uuid,date,text,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.receipt_movement_options(uuid,uuid,date,text,integer) to authenticated;
create function public.get_finance_receipt_movement_options(_tenant_id uuid,_account_id uuid,_date date,_search text,_page integer) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.receipt_movement_options(_tenant_id,_account_id,_date,_search,_page)$$;
revoke all on function public.get_finance_receipt_movement_options(uuid,uuid,date,text,integer) from public,anon,service_role;
grant execute on function public.get_finance_receipt_movement_options(uuid,uuid,date,text,integer) to authenticated;
revoke all on function finance_private.project_receivable_command() from public,anon,authenticated,service_role;
create trigger finance_project_receivable_command after insert on public.receivable_financial_commands for each row execute function finance_private.project_receivable_command();

-- Preserve the current command body (including fiscal guards), using the same
-- lock order as fiscal projection before taking any receivable graph row locks.
do $$declare body text;target text;begin
 select pg_get_functiondef('public.apply_receivable_financial_command(jsonb)'::regprocedure) into body;
 target:=' perform public._lock_receivable_financial_graph(v_tenant,v_id);';
 if position(target in body)=0 or position('''reference'',''matched''' in body)=0 then raise exception 'finance_receivable_projection_contract_changed';end if;
 body:=replace(body,target,E' perform pg_advisory_xact_lock(hashtextextended(''fiscal:''||v_tenant::text,0));\n perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||'':finance'',0));\n'||target);
 body:=replace(body,'''reference'',''matched''','''reference'',''unmatched''');
 target:='''attachment_path'',''payment_id''';
 if position(target in body)=0 then raise exception 'finance_receivable_payload_contract_changed';end if;
 body:=replace(body,target,target||',''movement_id''');
 target:=' v_hash:=encode(sha256(convert_to(_payload::text,''UTF8'')),''hex'');';
 if position(target in body)=0 then raise exception 'finance_receivable_hash_contract_changed';end if;
 body:=replace(body,target,E' if _payload ? ''movement_id'' and (v_action<>''receive'' or jsonb_typeof(_payload->''movement_id'') is distinct from ''string'' or (_payload->>''movement_id'')!~''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'') then raise exception ''financial_invalid_movement'' using errcode=''22023'';end if;\n'||target);
 target:=' insert into public.receivable_financial_commands(id,tenant_id,actor_id,request_id,receivable_id,action,reason,payload_hash,before_snapshot,after_snapshot,response)';
 if position(target in body)=0 then raise exception 'finance_receivable_result_contract_changed';end if;
 body:=replace(body,target,E' if _payload ? ''movement_id'' then v_result:=v_result||jsonb_build_object(''movement_id'',(_payload->>''movement_id'')::uuid);end if;\n'||target);
 execute body;
end;$$;
