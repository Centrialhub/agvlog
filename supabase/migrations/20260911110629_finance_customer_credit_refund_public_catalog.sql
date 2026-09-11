-- Public boundary pins reviewed refund core, capacity helpers and exact guards.
set lock_timeout='3s';set statement_timeout='30s';
do $pins$declare x record;p record;begin
 for x in select * from(values
('finance_private.audit_events(uuid,jsonb)','2647888bb5cf905f834981be5726618c',true,'s',true),
('finance_private.customer_credit_application_context(uuid,uuid,uuid,text,uuid)','147817459c401e86ca0e1647ae2cd9ca',true,'s',false),
('finance_private.customer_credit_position(uuid,uuid)','0e2098c0c0f79c666f31dbd9093538db',true,'s',false),
('finance_private.customer_credit_position_before_refunds(uuid,uuid)','9c7f511f9f20852086366abba5b2b56b',true,'s',false),
('finance_private.customer_credit_refund_context(uuid,uuid,uuid,text)','ec9d37e3e052a8ecaac2dc0b55376e72',true,'s',false),
('finance_private.customer_credit_source_evidence(uuid,uuid)','3184b4aa2eddc8ac7d7f831d6ffac48c',true,'s',false),
('finance_private.customer_refund_document(text)','3deb390554bc5d220a1d07f63f55c7bd',false,'i',false),
('finance_private.customer_refund_movement_origin(uuid,uuid)','636f7ec1bddbeedaf100be81ffcd54e1',true,'s',false),
('finance_private.forecast_customer_credit_evidence(uuid,uuid)','0d52a40e865dba8396d54c1eaed99d90',true,'s',false),
('finance_private.guard_customer_credit_application_insert()','22d45c1723d4a474dec714e19b961f9f',true,'v',false),
('finance_private.guard_customer_credit_refund()','2a6abf385b149446f1dde294f90c4fa0',true,'v',false),
('finance_private.movement_used_before_customer_refunds(uuid,uuid)','cc216802448c49d665d2b5d2e2335415',true,'s',false),
('finance_private.movement_used_cents(uuid,uuid)','a64a5e2f0ea0fdec562c4baa81b58fd4',true,'s',false),
('finance_private.record_customer_credit_application(jsonb)','d609af971a9baeb468f2341a648f3af1',true,'v',false),
('finance_private.record_customer_credit_refund(jsonb)','97a731740e397ddea91b3e9116438c90',true,'v',false),
('finance_private.release_receivable_customer_credits(uuid,uuid,text,uuid)','4f0decac7d15076018408b91077231e5',true,'v',false),
('finance_private.verify_customer_credit_application()','da2360750d5289651ac40ac3bf9c6032',true,'v',false),
('finance_private.verify_customer_credit_refund()','a2758b0ea02e328c786a52c534c07f94',true,'v',false),
('finance_private.customer_credit_options(uuid,jsonb)','6bf701bde6a39daf7d0595ef97b18f7d',true,'s',true)
 )v(signature,hash,is_definer,volatility,actor_execute) loop
 select * into p from pg_proc where oid=to_regprocedure(x.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from x.hash or p.prosecdef is distinct from x.is_definer or p.provolatile::text is distinct from x.volatility or p.proconfig is distinct from array['search_path=""']::text[] or has_function_privilege('authenticated',p.oid,'execute') is distinct from x.actor_execute or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner and(a.grantee<>(select oid from pg_roles where rolname='authenticated') or a.privilege_type<>'EXECUTE' or a.is_grantable)) then raise exception 'finance_credit_refund_public_predecessor_changed:%',x.signature using errcode='55000';end if;
 end loop;
 for x in select * from(values
 ('finance_private.customer_credit_refunds','preserve_customer_credit_refund','finance_private.preserve_event()',27,false),
 ('finance_private.customer_credit_refunds','guard_customer_credit_refund','finance_private.guard_customer_credit_refund()',7,false),
 ('finance_private.customer_credit_refunds','verify_customer_credit_refund','finance_private.verify_customer_credit_refund()',5,true),
 ('public.finance_movement_voids','a_customer_credit_refund_void','finance_private.guard_customer_credit_refund()',7,false))v(relation,name,signature,event_type,deferred) loop
 if not exists(select 1 from pg_trigger where tgrelid=to_regclass(x.relation) and tgname=x.name and tgfoid=to_regprocedure(x.signature) and tgtype=x.event_type and tgenabled='O' and tgqual is null and tgnargs=0 and tgdeferrable=x.deferred and tginitdeferred=x.deferred) then raise exception 'finance_credit_refund_public_guard_changed:%',x.name using errcode='55000';end if;
 end loop;
 if not exists(select 1 from pg_class c where c.oid='finance_private.customer_credit_refunds'::regclass and c.relrowsecurity and c.relkind='r' and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)) then raise exception 'finance_credit_refund_public_journal_changed' using errcode='55000';end if;
end$pins$;

create function finance_private.customer_credit_refund_options(_tenant_id uuid,_credit_id uuid,_query jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare kind text;search text;page_offset integer;page_limit integer;payer uuid;credit jsonb;m record;r record;ctx jsonb;rows jsonb:='[]';page jsonb;revision text;total integer;begin
 perform finance_private.require_access(_tenant_id);
 if jsonb_typeof(_query) is distinct from 'object' or exists(select 1 from jsonb_object_keys(_query)k where k<>all(array['kind','search','offset','limit','expected_revision'])) then raise exception 'finance_credit_refund_catalog_invalid' using errcode='22023';end if;
 kind:=_query->>'kind';search:=btrim(coalesce(_query->>'search',''));
 if coalesce(kind,'') not in('movements','history') or length(search)>200 or (_query ? 'offset' and coalesce(_query->>'offset','')!~'^(0|[1-9][0-9]{0,7})$') or (_query ? 'limit' and coalesce(_query->>'limit','')!~'^[1-9][0-9]{0,2}$') or(_query->>'expected_revision' is not null and _query->>'expected_revision'!~'^[a-f0-9]{32}$') then raise exception 'finance_credit_refund_catalog_invalid' using errcode='22023';end if;
 page_offset:=coalesce((_query->>'offset')::integer,0);page_limit:=coalesce((_query->>'limit')::integer,30);if page_limit>100 then raise exception 'finance_credit_refund_catalog_invalid' using errcode='22023';end if;
 credit:=finance_private.customer_credit_position(_tenant_id,_credit_id);payer:=(credit->>'payer_id')::uuid;
 if kind='movements' and credit->'valid'='true'::jsonb and (credit->>'available_cents')::numeric>0 then
  for m in select x.*,b.name bank_account_name from finance_private.active_movements x left join public.bank_accounts b on b.tenant_id=x.tenant_id and b.id=x.bank_account_id where x.tenant_id=_tenant_id and x.direction='out' and x.nature in('refund','payment','other') and x.driver_id is null and(search='' or strpos(lower(concat_ws(' ',x.description,x.beneficiary_name,x.beneficiary_document,b.name)),lower(search))>0) order by x.occurred_on desc,x.id loop
   ctx:=finance_private.customer_credit_refund_context(_tenant_id,_credit_id,m.id,'1');if ctx->'eligible' is distinct from 'true'::jsonb then continue;end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('movement_id',m.id,'bank_account_id',m.bank_account_id,'bank_account_name',m.bank_account_name,'occurred_on',m.occurred_on,'amount_cents',ctx#>>'{outgoing,amount_cents}','used_cents',ctx#>>'{outgoing,used_cents}','available_cents',ctx#>>'{outgoing,available_cents}','beneficiary_name',m.beneficiary_name,'beneficiary_document',ctx#>>'{outgoing,beneficiary_document}','revision',ctx->'revision'));
  end loop;
 elsif kind='history' then
  for r in select * from finance_private.customer_credit_refunds x where x.tenant_id=_tenant_id and x.credit_id=_credit_id and(search='' or strpos(lower(concat_ws(' ',x.actor_name,x.reason)),lower(search))>0) order by x.created_at desc,x.id loop
   rows:=rows||jsonb_build_array(jsonb_build_object('refund_id',r.id,'credit_id',r.credit_id,'payer_id',r.payer_id,'outgoing_movement_id',r.outgoing_movement_id,'amount_cents',r.amount_cents::text,'actor_id',r.actor_id,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at,'occurred_on',r.source_snapshot#>>'{movement,occurred_on}','bank_account_id',r.source_snapshot#>>'{movement,bank_account_id}'));
  end loop;
 end if;
 total:=jsonb_array_length(rows);if page_offset>total then raise exception 'finance_credit_refund_catalog_offset_invalid' using errcode='22023';end if;
 revision:=md5(jsonb_build_object('tenant',_tenant_id,'actor',auth.uid(),'credit',_credit_id,'position_revision',credit->'revision','kind',kind,'search',search,'rows',rows)::text);
 if _query->>'expected_revision' is not null and _query->>'expected_revision' is distinct from revision then raise exception 'finance_credit_refund_catalog_changed' using errcode='40001';end if;
 select coalesce(jsonb_agg(value order by ordinal),'[]') into page from jsonb_array_elements(rows) with ordinality q(value,ordinal) where ordinal>page_offset and ordinal<=page_offset+page_limit;
 return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'credit_id',_credit_id,'payer_id',payer,'kind',kind,'search',search,'offset',page_offset,'limit',page_limit,'total',total,'next_offset',case when page_offset+page_limit<total then page_offset+page_limit end,'revision',revision,'rows',page,'can_execute',false);
end$$;
create function public.get_finance_customer_credit_refund_options(_tenant_id uuid,_credit_id uuid,_query jsonb) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.customer_credit_refund_options(_tenant_id,_credit_id,_query)$$;
create function finance_private.dispatch_customer_credit_refund(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform finance_private.require_access((_payload->>'tenant_id')::uuid);return finance_private.record_customer_credit_refund(_payload);
end$$;
create function public.record_finance_customer_credit_refund(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.dispatch_customer_credit_refund(_payload)$$;
create function finance_private.preview_customer_credit_refund(_tenant_id uuid,_credit_id uuid,_outgoing_movement_id uuid,_amount_cents text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;can_invoke boolean;begin
 perform finance_private.require_access(_tenant_id);v:=finance_private.customer_credit_refund_context(_tenant_id,_credit_id,_outgoing_movement_id,_amount_cents);
 if v->>'tenant_id' is distinct from _tenant_id::text or v->>'actor_id' is distinct from auth.uid()::text or v->>'credit_id' is distinct from _credit_id::text or v->>'outgoing_movement_id' is distinct from _outgoing_movement_id::text or v->>'amount_cents' is distinct from _amount_cents then raise exception 'finance_credit_refund_preview_identity_invalid' using errcode='55000';end if;
 can_invoke:=has_function_privilege('authenticated','public.record_finance_customer_credit_refund(jsonb)','execute') and has_function_privilege('authenticated','finance_private.dispatch_customer_credit_refund(jsonb)','execute') and not has_function_privilege('authenticated','finance_private.record_customer_credit_refund(jsonb)','execute') and not has_function_privilege('anon','finance_private.record_customer_credit_refund(jsonb)','execute') and not has_function_privilege('service_role','finance_private.record_customer_credit_refund(jsonb)','execute');
 return (v-'_evidence')||jsonb_build_object('credit',(v->'credit')-'history'-'refund_history','can_execute',coalesce(v->'eligible'='true'::jsonb,false) and can_invoke);
end$$;
create function public.preview_finance_customer_credit_refund(_tenant_id uuid,_credit_id uuid,_outgoing_movement_id uuid,_amount_cents text) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.preview_customer_credit_refund(_tenant_id,_credit_id,_outgoing_movement_id,_amount_cents)$$;
revoke all on function finance_private.customer_credit_refund_options(uuid,uuid,jsonb),public.get_finance_customer_credit_refund_options(uuid,uuid,jsonb),finance_private.dispatch_customer_credit_refund(jsonb),public.record_finance_customer_credit_refund(jsonb),finance_private.preview_customer_credit_refund(uuid,uuid,uuid,text),public.preview_finance_customer_credit_refund(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.customer_credit_refund_options(uuid,uuid,jsonb),public.get_finance_customer_credit_refund_options(uuid,uuid,jsonb),finance_private.dispatch_customer_credit_refund(jsonb),public.record_finance_customer_credit_refund(jsonb),finance_private.preview_customer_credit_refund(uuid,uuid,uuid,text),public.preview_finance_customer_credit_refund(uuid,uuid,uuid,text) to authenticated;
do $credit_catalog$declare body text;needle text:='''released_cents'',p->''released_cents'',';begin
 select pg_get_functiondef('finance_private.customer_credit_options(uuid,jsonb)'::regprocedure) into body;
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'finance_credit_returned_catalog_contract_changed' using errcode='55000';end if;
 execute replace(body,needle,needle||'''returned_cents'',p->''returned_cents'',');
end$credit_catalog$;
