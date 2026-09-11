-- Production predecessor bodies independently read by the coordinator; normalize CRLF only.
do $guard$declare expected record;p record;begin
 for expected in select * from (values
 ('finance_private.list_expenses(uuid,jsonb)','d3f0fea08bcc2492639374d82b085f45'),
 ('finance_private.recorded_costs(uuid,jsonb)','ae9d3d545472245fac0a3f4166eacda9'),
 ('finance_private.settlement_expense_context(uuid,uuid,integer)','f3d4aa01c39a80e2530a2eb3cd4f49ea'),
 ('finance_private.canonical_trip_costs(uuid,uuid)','b8aaa56e791f0b83b8b1ac2000faa5ee'),
 ('finance_private.recorded_cost_summary(uuid,date,date,text,text)','00ea8c8e61833f8064d2fed0ec4ec199'),
 ('finance_private.payable_portfolio(uuid,jsonb,integer,text)','87e36f40b3eebf97cbc7a9577bd83d5d')) x(signature,hash) loop
 select * into p from pg_proc where oid=to_regprocedure(expected.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from expected.hash or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[]
 or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
 or has_function_privilege('authenticated',p.oid,'execute') is distinct from (expected.signature<>'finance_private.canonical_trip_costs(uuid,uuid)')
 or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner,'authenticated'::regrole::oid))
 then raise exception 'effective_cost_predecessor_changed: %',expected.signature using errcode='55000';end if;
 end loop;
end $guard$;
-- Effective operational costs retain immutable originals; no new cash or driver credit.
create function finance_private.effective_cost_amount(t uuid,expense uuid,strict boolean default false) returns bigint
language plpgsql stable security definer set search_path='' as $$declare v jsonb;begin
 v:=finance_private.expense_cost_effective(t,expense);
 if v->'verified' is distinct from 'true'::jsonb or v->>'effective_amount_cents' is null then
  if strict then raise exception 'finance_cost_version_unverified' using errcode='55000';end if;return null;
 end if;return (v->>'effective_amount_cents')::bigint;
end$$;
create function finance_private.expense_cost_version(t uuid,expense uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('expense_id',expense,'verified',v->'verified','amendment_id',v#>'{history,-1,id}','revision',v->'revision','amount_cents',v->'effective_amount_cents') from (select finance_private.expense_cost_effective(t,expense) v) s
$$;
revoke all on function finance_private.effective_cost_amount(uuid,uuid,boolean),finance_private.expense_cost_version(uuid,uuid) from public,anon,authenticated,service_role;
do $patch$declare body text;needle text;replacement text;begin
 select pg_get_functiondef('finance_private.recorded_costs(uuid,jsonb)'::regprocedure) into body;body:=replace(body,E'\r\n',E'\n');
 needle:=$old$e.amount_cents::numeric amount_cents$old$;replacement:=$new$finance_private.effective_cost_amount(e.tenant_id,e.id)::numeric amount_cents$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed recorded_costs: %',needle;end if;body:=replace(body,needle,replacement);
 needle:=$old$finance_private.expense_is_cancelled(e.tenant_id,e.id) cancelled,false needs_review$old$;replacement:=$new$finance_private.expense_is_cancelled(e.tenant_id,e.id) cancelled,finance_private.effective_cost_amount(e.tenant_id,e.id) is null needs_review$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed recorded_costs: %',needle;end if;body:=replace(body,needle,replacement);
 needle:=$old$coalesce(sum(amount_cents) filter(where not cancelled),0)::text amount_cents,count(*) item_count
  from filtered group by cost_center_id,cost_center_name$old$;replacement:=$new$case when bool_or(needs_review and not cancelled) then null else coalesce(sum(amount_cents) filter(where not cancelled),0)::text end amount_cents,count(*) item_count
  from filtered group by cost_center_id,cost_center_name$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed recorded_costs: %',needle;end if;body:=replace(body,needle,replacement);
 needle:=$old$select category,coalesce(sum(amount_cents) filter(where not cancelled),0)::text amount_cents$old$;replacement:=$new$select category,case when bool_or(needs_review and not cancelled) then null else coalesce(sum(amount_cents) filter(where not cancelled),0)::text end amount_cents$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed recorded_costs: %',needle;end if;body:=replace(body,needle,replacement);
 needle:=$old$'total_cents',(select coalesce(sum(amount_cents) filter(where not cancelled),0)::text from filtered)$old$;replacement:=$new$'total_cents',(select case when bool_or(needs_review and not cancelled) then null else coalesce(sum(amount_cents) filter(where not cancelled),0)::text end from filtered)$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed recorded_costs: %',needle;end if;body:=replace(body,needle,replacement);
 execute body;end $patch$;
do $patch$declare body text;needle text;replacement text;begin
 select pg_get_functiondef('finance_private.recorded_cost_summary(uuid,date,date,text,text)'::regprocedure) into body;body:=replace(body,E'\r\n',E'\n');
 needle:=$old$e.amount_cents::numeric amount_cents$old$;replacement:=$new$finance_private.effective_cost_amount(e.tenant_id,e.id)::numeric amount_cents$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.recorded_cost_summary(uuid,date,date,text,text)';end if;body:=replace(body,needle,replacement);
 needle:=$old$finance_private.expense_is_cancelled(e.tenant_id,e.id) cancelled,false needs_review$old$;replacement:=$new$finance_private.expense_is_cancelled(e.tenant_id,e.id) cancelled,finance_private.effective_cost_amount(e.tenant_id,e.id) is null needs_review$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.recorded_cost_summary(uuid,date,date,text,text)';end if;body:=replace(body,needle,replacement);
 execute body;end $patch$;
do $patch$declare body text;needle text;replacement text;begin
 select pg_get_functiondef('finance_private.canonical_trip_costs(uuid,uuid)'::regprocedure) into body;body:=replace(body,E'\r\n',E'\n');
 needle:=$old$e.amount_cents::numeric/100$old$;replacement:=$new$finance_private.effective_cost_amount(e.tenant_id,e.id,true)::numeric/100$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.canonical_trip_costs(uuid,uuid)';end if;body:=replace(body,needle,replacement);
 needle:=$old$'canonical_cost_version',1$old$;replacement:=$new$'expense_cost_version',finance_private.expense_cost_version(e.tenant_id,e.id),'original_amount_cents',e.amount_cents::text,'canonical_cost_version',2$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.canonical_trip_costs(uuid,uuid)';end if;body:=replace(body,needle,replacement);
 execute body;end $patch$;
do $patch$declare body text;needle text;replacement text;begin
 select pg_get_functiondef('finance_private.settlement_expense_context(uuid,uuid,integer)'::regprocedure) into body;body:=replace(body,E'\r\n',E'\n');
 needle:=$old$e.occurred_on,e.amount_cents,$old$;replacement:=$new$e.occurred_on,finance_private.effective_cost_amount(e.tenant_id,e.id) amount_cents,finance_private.expense_cost_effective(e.tenant_id,e.id) cost_origin,$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.settlement_expense_context(uuid,uuid,integer)';end if;body:=replace(body,needle,replacement);
 needle:=$old$greatest(e.amount_cents-coalesce(a.cents,0),0) complement$old$;replacement:=$new$case when finance_private.effective_cost_amount(e.tenant_id,e.id) is not null then greatest(finance_private.effective_cost_amount(e.tenant_id,e.id)-coalesce(a.cents,0),0) end complement$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.settlement_expense_context(uuid,uuid,integer)';end if;body:=replace(body,needle,replacement);
 needle:=$old$(paid_invalid or allocated>amount_cents$old$;replacement:=$new$(amount_cents is null or paid_invalid or allocated>amount_cents$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.settlement_expense_context(uuid,uuid,integer)';end if;body:=replace(body,needle,replacement);
 needle:=$old$'amount_cents',amount_cents::text,'allocated_cents'$old$;replacement:=$new$'cost_origin',cost_origin,'amount_cents',amount_cents::text,'allocated_cents'$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.settlement_expense_context(uuid,uuid,integer)';end if;body:=replace(body,needle,replacement);
 needle:=$old$coalesce(sum(amount_cents),0)::text from assessed$old$;replacement:=$new$case when bool_or(amount_cents is null) then null else coalesce(sum(amount_cents),0)::text end from assessed$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.settlement_expense_context(uuid,uuid,integer)';end if;body:=replace(body,needle,replacement);
 needle:=$old$coalesce(sum(allocated),0)::text from assessed$old$;replacement:=$new$case when bool_or(amount_cents is null) then null else coalesce(sum(allocated),0)::text end from assessed$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.settlement_expense_context(uuid,uuid,integer)';end if;body:=replace(body,needle,replacement);
 needle:=$old$coalesce(sum(complement),0)::text from assessed$old$;replacement:=$new$case when bool_or(amount_cents is null) then null else coalesce(sum(complement),0)::text end from assessed$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.settlement_expense_context(uuid,uuid,integer)';end if;body:=replace(body,needle,replacement);
 needle:=$old$coalesce(sum(paid),0)::text from assessed$old$;replacement:=$new$case when bool_or(amount_cents is null) then null else coalesce(sum(paid),0)::text end from assessed$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.settlement_expense_context(uuid,uuid,integer)';end if;body:=replace(body,needle,replacement);
 needle:=$old$coalesce(sum(outstanding),0)::text from assessed$old$;replacement:=$new$case when bool_or(amount_cents is null) then null else coalesce(sum(outstanding),0)::text end from assessed$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.settlement_expense_context(uuid,uuid,integer)';end if;body:=replace(body,needle,replacement);
 execute body;end $patch$;
do $patch$declare body text;needle text;replacement text;begin
 select pg_get_functiondef('finance_private.list_expenses(uuid,jsonb)'::regprocedure) into body;body:=replace(body,E'\r\n',E'\n');
 needle:=$old$select e.*,$old$;replacement:=$new$select e.*,finance_private.expense_cost_effective(e.tenant_id,e.id) cost_origin,finance_private.effective_cost_amount(e.tenant_id,e.id) effective_amount_cents,$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.list_expenses(uuid,jsonb)';end if;body:=replace(body,needle,replacement);
 needle:=$old$select category,sum(amount_cents)::text amount_cents$old$;replacement:=$new$select category,case when bool_or(effective_amount_cents is null) then null else sum(effective_amount_cents)::text end amount_cents$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.list_expenses(uuid,jsonb)';end if;body:=replace(body,needle,replacement);
 needle:=$old$select cost_center_id,cost_center_name,sum(amount_cents)::text amount_cents$old$;replacement:=$new$select cost_center_id,cost_center_name,case when bool_or(effective_amount_cents is null) then null else sum(effective_amount_cents)::text end amount_cents$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.list_expenses(uuid,jsonb)';end if;body:=replace(body,needle,replacement);
 needle:=$old$'total_cents',(select coalesce(sum(amount_cents),0)::text from filtered where not cancelled)$old$;replacement:=$new$'cost_needs_review_count',(select count(*) from filtered where not cancelled and effective_amount_cents is null),'total_cents',(select case when bool_or(effective_amount_cents is null) then null else coalesce(sum(effective_amount_cents),0)::text end from filtered where not cancelled)$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.list_expenses(uuid,jsonb)';end if;body:=replace(body,needle,replacement);
 needle:=$old$coalesce(sum(amount_cents-allocated_cents),0)::text from filtered where not cancelled$old$;replacement:=$new$case when bool_or(effective_amount_cents is null) then null else coalesce(sum(effective_amount_cents-allocated_cents),0)::text end from filtered where not cancelled$new$;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_reader_predecessor_changed: finance_private.list_expenses(uuid,jsonb)';end if;body:=replace(body,needle,replacement);
 needle:=$old$jsonb_agg(to_jsonb(r) order by occurred_on desc,created_at desc,id desc)$old$;replacement:=$new$jsonb_agg(to_jsonb(r)||jsonb_build_object('effective_amount_cents',r.effective_amount_cents::text) order by occurred_on desc,created_at desc,id desc)$new$;
 if position(needle in body)=0 then raise exception 'effective_cost_list_row_changed';end if;body:=replace(body,needle,replacement);
 execute body;end $patch$;

-- Capture an immutable cost version in the existing payment audit transaction.
create function finance_private.capture_payment_cost_version() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.payables%rowtype;cost jsonb;begin
 if new.action is distinct from 'payable_movement_applied' then return new;end if;
 select x.* into p from public.payables_payments pp join public.payables x on x.tenant_id=pp.tenant_id and x.id=pp.payable_id where pp.tenant_id=new.tenant_id and pp.id=new.entity_id;
 if p.source_table='finance_expense_items' then
  cost:=finance_private.expense_cost_version(new.tenant_id,p.source_id);
  if cost->'verified' is distinct from 'true'::jsonb then raise exception 'finance_cost_version_unverified' using errcode='55000';end if;
  new.after_data:=new.after_data||jsonb_build_object('expense_cost_version',cost);
 end if;return new;
end$$;
revoke all on function finance_private.capture_payment_cost_version() from public,anon,authenticated,service_role;
create trigger finance_payment_cost_version before insert on public.finance_events for each row execute function finance_private.capture_payment_cost_version();
create function finance_private.payable_effective_cost_evidence(t uuid,payable uuid,ev jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.payables%rowtype;cost jsonb;versions jsonb;begin
 select * into p from public.payables where tenant_id=t and id=payable;
 if p.source_table is distinct from 'finance_expense_items' then return ev;end if;
 if not exists(select 1 from public.finance_expense_items e where e.tenant_id=t and e.id=p.source_id and e.payable_id=p.id) then
  return ev||jsonb_build_object('valid',false,'nominal_cents',null,'paid_cents',null,'open_cents',null,'expense_cost_version',null,'payment_cost_versions','[]'::jsonb,'issues',coalesce(ev->'issues','[]')||jsonb_build_array('finance_cost_version_unverified'),'revision',md5(jsonb_build_object('prior',ev->'revision','missing_cost_source',p.source_id)::text));
 end if;
 cost:=finance_private.expense_cost_version(t,p.source_id);
 select coalesce(jsonb_agg(jsonb_build_object('payment_id',e.entity_id,'event_id',e.id,'cost_version',e.after_data->'expense_cost_version') order by e.id),'[]') into versions
 from public.finance_events e join public.payables_payments pp on pp.tenant_id=e.tenant_id and pp.id=e.entity_id
 where e.tenant_id=t and pp.payable_id=payable and e.action='payable_movement_applied' and e.after_data ? 'expense_cost_version';
 ev:=ev||jsonb_build_object('expense_cost_version',cost,'payment_cost_versions',versions,'revision',md5(jsonb_build_object('prior',ev->'revision','cost',cost,'payments',versions)::text));
 if cost->'verified' is distinct from 'true'::jsonb then ev:=ev||jsonb_build_object('valid',false,'nominal_cents',null,'paid_cents',null,'open_cents',null,'issues',coalesce(ev->'issues','[]')||jsonb_build_array('finance_cost_version_unverified'));end if;
 return ev;
end$$;
revoke all on function finance_private.payable_effective_cost_evidence(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
do $patch$declare body text;needle text;replacement text;begin
 select pg_get_functiondef('finance_private.payable_portfolio(uuid,jsonb,integer,text)'::regprocedure) into body;
 needle:='finance_private.payable_portfolio_evidence(_tenant,p.id) ev';
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'effective_cost_portfolio_predecessor_changed';end if;
 body:=replace(body,needle,'finance_private.payable_effective_cost_evidence(_tenant,p.id,finance_private.payable_portfolio_evidence(_tenant,p.id)) ev');
 needle:='''payment_ids'',ev->''payment_ids''';if position(needle in body)=0 then raise exception 'effective_cost_portfolio_row_changed';end if;
 body:=replace(body,needle,'''expense_cost_version'',ev->''expense_cost_version'',''payment_cost_versions'',coalesce(ev->''payment_cost_versions'',''[]''::jsonb),'||needle);execute body;
end $patch$;
