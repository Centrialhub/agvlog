do $$declare body text;needle text;replacement text;begin
 select pg_get_functiondef('finance_private.account_opening(uuid,uuid,date,date)'::regprocedure) into body;
 needle:='from public.finance_account_openings a left join public.finance_account_opening_reversals r on r.tenant_id=_tenant and r.opening_id=a.id where a.tenant_id=_tenant and a.bank_account_id=_account;';
 replacement:='from (select * from public.finance_account_openings where tenant_id=_tenant and bank_account_id=_account order by created_at desc,id desc limit 20) a left join public.finance_account_opening_reversals r on r.tenant_id=_tenant and r.opening_id=a.id;';
 if position(needle in body)=0 then raise exception 'finance_account_opening_history_contract_changed';end if;body:=replace(body,needle,replacement);
 needle:='''history'',history,''can_close''';if position(needle in body)=0 then raise exception 'finance_account_opening_envelope_changed';end if;
 execute replace(body,needle,'''history'',history,''history_has_more'',exists(select 1 from public.finance_account_openings where tenant_id=_tenant and bank_account_id=_account offset 20),''can_close''');
end$$;

create function finance_private.account_opening_history(_tenant uuid,_account uuid,_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare rows jsonb;begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 100000 then raise exception 'finance_invalid_page' using errcode='22023';end if;
 if not exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=_account) then raise exception 'finance_account_not_found' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('evidence_type',a.evidence_type,'evidence',case when a.evidence_type='cash_count_v1' then a.evidence else jsonb_build_object('opening_anchors',a.evidence->'opening_anchors') end,'id',a.id,'effective_from',a.effective_from,'balance_cents',a.balance_cents::text,'actor_id',a.actor_id,'actor_name',a.actor_name,'reason',a.reason,'created_at',a.created_at,'reversal',case when r.id is null then null else jsonb_build_object('id',r.id,'actor_id',r.actor_id,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at) end) order by a.created_at desc,a.id desc),'[]') into rows
 from(select * from public.finance_account_openings where tenant_id=_tenant and bank_account_id=_account order by created_at desc,id desc limit 20 offset((_page-1)*20))a left join public.finance_account_opening_reversals r on r.tenant_id=_tenant and r.opening_id=a.id;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'account_id',_account,'page',_page,'page_size',20,'has_more',exists(select 1 from public.finance_account_openings where tenant_id=_tenant and bank_account_id=_account offset(_page*20)),'rows',rows);
end$$;
revoke all on function finance_private.account_opening_history(uuid,uuid,integer) from public,anon,authenticated,service_role;grant execute on function finance_private.account_opening_history(uuid,uuid,integer) to authenticated;
create function public.get_finance_account_opening_history(_tenant_id uuid,_account_id uuid,_page integer default 1) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.account_opening_history(_tenant_id,_account_id,_page)$$;
revoke all on function public.get_finance_account_opening_history(uuid,uuid,integer) from public,anon,authenticated,service_role;grant execute on function public.get_finance_account_opening_history(uuid,uuid,integer) to authenticated;

do $$declare body text;needle text;begin
 if to_regprocedure('finance_private.cash_forecast_collect_before_agenda(uuid,date,date)') is null then return;end if;
 select pg_get_functiondef('finance_private.cash_forecast_collect_before_agenda(uuid,date,date)'::regprocedure) into body;
 needle:='opening:=ev->''opening'';source:=ev;source_table:=''finance_account_openings'';';
 if position(needle in body)=0 then raise exception 'finance_forecast_opening_source_contract_changed';end if;
 execute replace(body,needle,'opening:=ev->''opening'';source:=ev-''history''-''history_has_more'';source_table:=''finance_account_openings'';');
end$$;
