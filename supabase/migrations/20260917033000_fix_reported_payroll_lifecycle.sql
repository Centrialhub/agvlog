-- Live bug queue 210-216.

create or replace function finance_private.guard_payroll_period_overlap() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
 if new.status<>'cancelled' and exists(select 1 from public.payroll_periods p
   where p.tenant_id=new.tenant_id and p.id<>new.id and p.status<>'cancelled'
     and daterange(p.period_start,p.period_end,'[]')&&daterange(new.period_start,new.period_end,'[]')) then
  raise exception 'finance_payroll_period_overlap' using errcode='23P01';
 end if;return new;
end;$fn$;
revoke all on function finance_private.guard_payroll_period_overlap() from public,anon,authenticated,service_role;
drop trigger if exists a_payroll_period_overlap on public.payroll_periods;
create trigger a_payroll_period_overlap before insert or update of tenant_id,period_start,period_end,status on public.payroll_periods
for each row execute function finance_private.guard_payroll_period_overlap();

do $patch_generator$
declare body text;anchor text:='  -- Limpar issues antigas deste período';addition text;
begin
 select pg_get_functiondef('public.generate_payroll_period(uuid,date,date,text,boolean,boolean)'::regprocedure) into body;
 if position('finance_payroll_scope_refresh' in body)>0 then return;end if;
 if position(anchor in body)=0 then raise exception 'finance_payroll_generator_contract_changed';end if;
 addition:=$sql$  -- finance_payroll_scope_refresh
  if exists(select 1 from public.payroll_periods p where p.tenant_id=_tenant_id and p.id<>_period_id and p.status<>'cancelled'
    and daterange(p.period_start,p.period_end,'[]')&&daterange(_period_start,_period_end,'[]')) then
    raise exception 'finance_payroll_period_overlap' using errcode='23P01';
  end if;
  update public.payroll_periods set
    period_name=coalesce(nullif(btrim(_period_name),''),'Folha '||to_char(_period_start,'DD/MM/YYYY')||' - '||to_char(_period_end,'DD/MM/YYYY')),
    include_drivers=_include_drivers,include_non_drivers=_include_non_drivers,updated_at=now()
  where id=_period_id and tenant_id=_tenant_id and status in('draft','calculated');
  delete from public.payroll_entries e where e.tenant_id=_tenant_id and e.payroll_period_id=_period_id and e.status in('draft','calculated')
    and ((_include_drivers=false and e.driver_id is not null) or (_include_non_drivers=false and e.driver_id is null));

$sql$;
 execute replace(body,anchor,addition||anchor);
end;$patch_generator$;

do $patch_approval$
declare body text;anchor text:='  FOR _entry IN SELECT';addition text;
begin
 select pg_get_functiondef('public.approve_payroll_period(uuid)'::regprocedure) into body;
 if position('finance_payroll_unresolved_generation_issues' in body)>0 then return;end if;
 if position(anchor in body)=0 then raise exception 'finance_payroll_approval_contract_changed';end if;
 addition:=$sql$  if exists(select 1 from public.payroll_generation_issues where payroll_period_id=_period_id and not resolved) then
    raise exception 'finance_payroll_unresolved_generation_issues' using errcode='23514';
  end if;

$sql$;
 execute replace(body,anchor,addition||anchor);
end;$patch_approval$;

do $patch_close$
declare body text;old text:='IF _open_balance > 0 AND (_reason IS NULL OR length(trim(_reason)) = 0) THEN';
begin
 select pg_get_functiondef('public.close_payroll_period(uuid,text)'::regprocedure) into body;
 if position(old in body)=0 then raise exception 'finance_payroll_close_reason_contract_changed';end if;
 execute replace(body,old,'IF _reason IS NULL OR length(trim(_reason)) = 0 THEN');
end;$patch_close$;

-- Permit only this audited lifecycle command through the generic immutable-row
-- trigger. Direct table grants remain revoked.
do $patch_guard$
declare body text;anchor text:=' t:=coalesce((old_data->>''tenant_id'')::uuid,(new_data->>''tenant_id'')::uuid);';
begin
 select pg_get_functiondef('finance_private.protect_payroll_write()'::regprocedure) into body;
 if position('app.payroll_lifecycle_command' in body)>0 then return;end if;
 if position(anchor in body)=0 then raise exception 'finance_payroll_guard_contract_changed';end if;
 execute replace(body,anchor,anchor||E'\n if current_setting(''app.payroll_lifecycle_command'',true)=t::text then if tg_op=''DELETE'' then return old;end if;return new;end if;');
end;$patch_guard$;

create or replace function public.change_payroll_period_state(_period_id uuid,_action text,_reason text) returns void
language plpgsql security definer set search_path='' as $fn$
declare p public.payroll_periods%rowtype;actor uuid:=auth.uid();
begin
 select * into p from public.payroll_periods where id=_period_id for update;
 if p.id is null or actor is null or not public.is_tenant_admin(p.tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if coalesce(length(btrim(_reason)),0) not between 5 and 2000 or _action not in('cancel','reopen') then raise exception 'finance_invalid_payroll_lifecycle' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p.tenant_id::text||':finance',0));
 if exists(select 1 from public.payables q join finance_private.active_payable_payments pay on pay.tenant_id=q.tenant_id and pay.payable_id=q.id
   join public.payroll_entries e on e.tenant_id=q.tenant_id and e.id=q.source_id
   where q.tenant_id=p.tenant_id and q.source_table='payroll_entries' and e.payroll_period_id=p.id) then
  raise exception 'finance_payroll_has_payments' using errcode='55000';
 end if;
 perform set_config('app.payroll_lifecycle_command',p.tenant_id::text,true);
 if _action='cancel' then
  if p.status not in('draft','calculated','under_review','approved') then raise exception 'finance_payroll_cannot_cancel' using errcode='55000';end if;
  update public.payables q set status='cancelled',notes=concat_ws(E'\n',q.notes,'[Folha cancelada] '||btrim(_reason)),updated_at=now()
   from public.payroll_entries e where e.tenant_id=p.tenant_id and e.payroll_period_id=p.id and q.tenant_id=e.tenant_id and q.source_table='payroll_entries' and q.source_id=e.id and q.status<>'cancelled';
  update public.payroll_entries set status='cancelled' where tenant_id=p.tenant_id and payroll_period_id=p.id;
  update public.payroll_periods set status='cancelled',notes=concat_ws(E'\n',notes,'[Cancelamento] '||btrim(_reason)),updated_at=now() where id=p.id;
 else
  if p.status<>'cancelled' then raise exception 'finance_payroll_cannot_reopen' using errcode='55000';end if;
  update public.payables q set status='pending',updated_at=now()
   from public.payroll_entries e where e.tenant_id=p.tenant_id and e.payroll_period_id=p.id and q.tenant_id=e.tenant_id and q.source_table='payroll_entries' and q.source_id=e.id and q.status='cancelled';
  update public.payroll_entry_items set locked=false where tenant_id=p.tenant_id and payroll_period_id=p.id;
  update public.payroll_entries set status='calculated' where tenant_id=p.tenant_id and payroll_period_id=p.id;
  update public.payroll_periods set status='calculated',approved_by=null,approved_at=null,closed_by=null,closed_at=null,
    notes=concat_ws(E'\n',notes,'[Reabertura] '||btrim(_reason)),updated_at=now() where id=p.id;
 end if;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(p.tenant_id,'payroll_period',p.id,'payroll_period_'||case when _action='cancel' then 'cancelled' else 'reopened' end,actor,
  coalesce((select full_name from public.profiles where id=actor),actor::text),btrim(_reason),to_jsonb(p),
  (select to_jsonb(x) from public.payroll_periods x where x.id=p.id)||jsonb_build_object('manual_intervention',true));
end;$fn$;
revoke all on function public.change_payroll_period_state(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.change_payroll_period_state(uuid,text,text) to authenticated;

create or replace function public.get_finance_payroll_period_page(_tenant_id uuid,_page integer default 1,_page_size integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page not between 1 and 1000000 or _page_size not between 1 and 100 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 with chosen as materialized(select id from public.payroll_periods where tenant_id=_tenant_id order by period_start desc,id limit _page_size offset (_page-1)*_page_size),
 projected as(select (finance_private.payroll_period_projection(_tenant_id,c.id)->'rows'->0) row from chosen c)
 select jsonb_build_object('version',1,'tenant_id',_tenant_id,'page',_page,'page_size',_page_size,
  'total',(select count(*) from public.payroll_periods where tenant_id=_tenant_id),
  'rows',coalesce(jsonb_agg(row order by row->>'period_start' desc,row->>'id'),'[]'::jsonb)) into result from projected;
 return result;
end;$fn$;
revoke all on function public.get_finance_payroll_period_page(uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_payroll_period_page(uuid,integer,integer) to authenticated;
