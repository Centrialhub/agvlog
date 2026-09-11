-- Public credit application boundary and paginated safe catalog.
-- Reviewed core functions and exact guard shape are required.
set lock_timeout='3s';set statement_timeout='30s';
do $core_pins$declare s record;p record;begin
 for s in select * from(values
('finance_private.audit_events(uuid,jsonb)','6c7960750c3acb7d3ceba891e924fecb',true,'s',true),
('finance_private.cash_receivable_ledger_evidence(uuid,uuid)','351d7b05301ec509747944c68ea6c49e',false,'s',false),
('finance_private.customer_credit_application_context(uuid,uuid,uuid,text,uuid)','896f7c6c668df92def2bf361330a8156',true,'s',false),
('finance_private.customer_credit_position(uuid,uuid)','9c7f511f9f20852086366abba5b2b56b',true,'s',false),
('finance_private.customer_credit_source_evidence(uuid,uuid)','3184b4aa2eddc8ac7d7f831d6ffac48c',true,'s',false),
('finance_private.guard_customer_credit_application_insert()','22d45c1723d4a474dec714e19b961f9f',true,'v',false),
('finance_private.process_fiscal_observation(uuid,uuid)','5be67b8fe326ec383618052fd90c75e9',true,'v',false),
('finance_private.receivable_credit_evidence(uuid,uuid)','d62bb1656e6be89b7753f44c6e5501dc',false,'s',false),
('finance_private.record_customer_credit_application(jsonb)','6b04a6f7a7c514ec40976f3550988577',true,'v',false),
('finance_private.release_receivable_customer_credits(uuid,uuid,text,uuid)','4f0decac7d15076018408b91077231e5',true,'v',false),
('finance_private.sync_credit_application_projection()','e1f657a380c67e6a277fd91d615c27db',true,'v',false),
('finance_private.verify_customer_credit_application()','da2360750d5289651ac40ac3bf9c6032',true,'v',false),
('public._guard_receivable_ledger()','ccba9ce7b0afd669374dbc564d22be19',true,'v',false),
('public._invoice_lifecycle_snapshot(uuid,uuid)','af796b4802563eb3435dab6dbed8046a',false,'s',false),
('public._recalc_receivable_received()','3ace7a905df9b11f0a1e1e3117f76ebb',true,'v',false),
('public._receivable_financial_snapshot(uuid,uuid)','473e509e0283627f5520dddfb36a083d',false,'s',false),
('public._receivable_ledger_evidence(uuid,uuid)','51dc0bea52d353a7b6407fb6faa50cf0',false,'s',false),
('public.apply_client_invoice_command(jsonb)','0c581f489eef3cb23cfa6c068e819d60',true,'v',true)
 )v(signature,hash,is_definer,volatility,actor_execute) loop
 select * into p from pg_proc where oid=to_regprocedure(s.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from s.hash or p.prosecdef is distinct from s.is_definer or p.provolatile::text is distinct from s.volatility or p.proconfig is distinct from array['search_path=""']::text[] or has_function_privilege('authenticated',p.oid,'execute') is distinct from s.actor_execute or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner and(a.grantee<>(select oid from pg_roles where rolname='authenticated') or a.privilege_type<>'EXECUTE' or a.is_grantable)) then raise exception 'finance_credit_public_core_changed:%',s.signature using errcode='55000';end if;
 end loop;
 for s in select * from(values
 ('preserve_customer_credit_application','finance_private.preserve_event()',27,false),
 ('guard_customer_credit_application_insert','finance_private.guard_customer_credit_application_insert()',7,false),
 ('recalc_credit_application','public._recalc_receivable_received()',5,false),
 ('zz_sync_credit_application','finance_private.sync_credit_application_projection()',5,false),
 ('verify_customer_credit_application','finance_private.verify_customer_credit_application()',5,true))v(name,signature,event_type,deferred) loop
 if not exists(select 1 from pg_trigger where tgrelid='finance_private.customer_credit_application_events'::regclass and tgname=s.name and tgfoid=to_regprocedure(s.signature) and tgtype=s.event_type and tgenabled='O' and tgqual is null and tgnargs=0 and tgdeferrable=s.deferred and tginitdeferred=s.deferred) then raise exception 'finance_credit_public_trigger_changed:%',s.name using errcode='55000';end if;
 end loop;
 if not exists(select 1 from pg_class c where c.oid='finance_private.customer_credit_application_events'::regclass and c.relrowsecurity and c.relkind='r' and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)) then raise exception 'finance_credit_public_journal_changed' using errcode='55000';end if;
end$core_pins$;


create function finance_private.customer_credit_options(_tenant_id uuid,_query jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare kind text;credit uuid;v_payer uuid;search text;only_available boolean;page_offset integer;page_limit integer;
 c record;r record;e record;p jsonb;s jsonb;ctx jsonb;remaining numeric;rows jsonb:='[]';page jsonb;revision text;total integer;label text;
begin
 perform finance_private.require_access(_tenant_id);
 if jsonb_typeof(_query) is distinct from 'object' or exists(select 1 from jsonb_object_keys(_query) k where k<>all(array['kind','credit_id','payer_id','search','available_only','offset','limit','expected_revision'])) then raise exception 'finance_credit_catalog_query_invalid' using errcode='22023';end if;
 kind:=_query->>'kind';search:=btrim(coalesce(_query->>'search',''));credit:=(_query->>'credit_id')::uuid;v_payer:=(_query->>'payer_id')::uuid;
 if coalesce(kind,'') not in('credits','targets','history') or length(search)>200 or (kind<>'credits' and (credit is null or v_payer is not null or _query->'available_only'='true'::jsonb)) or(kind='credits' and credit is not null)
 or (_query ? 'available_only' and jsonb_typeof(_query->'available_only') is distinct from 'boolean')
 or (_query ? 'offset' and coalesce(_query->>'offset','')!~'^(0|[1-9][0-9]{0,7})$') or(_query ? 'limit' and coalesce(_query->>'limit','')!~'^[1-9][0-9]{0,2}$')
 or(_query->>'expected_revision' is not null and coalesce(_query->>'expected_revision','')!~'^[a-f0-9]{32}$') then raise exception 'finance_credit_catalog_query_invalid' using errcode='22023';end if;
 page_offset:=coalesce((_query->>'offset')::integer,0);page_limit:=coalesce((_query->>'limit')::integer,30);only_available:=coalesce((_query->>'available_only')::boolean,false);
 if page_limit>100 then raise exception 'finance_credit_catalog_query_invalid' using errcode='22023';end if;
 if kind<>'credits' then select payer_id into v_payer from public.finance_customer_credits where tenant_id=_tenant_id and id=credit;if not found then raise exception 'finance_customer_credit_missing' using errcode='22023';end if;end if;
 if kind='credits' then
  for c in select x.*,coalesce(nullif(cl.company_name,''),x.payer_id::text) payer_name from public.finance_customer_credits x left join public.clients cl on cl.tenant_id=x.tenant_id and cl.id=x.payer_id where x.tenant_id=_tenant_id and (v_payer is null or x.payer_id=v_payer) and(search='' or strpos(lower(coalesce(cl.company_name,'')),lower(search))>0 or strpos(x.id::text,lower(search))>0) order by x.created_at desc,x.id loop
   p:=finance_private.customer_credit_position(_tenant_id,c.id);
   if only_available and (p->'valid' is distinct from 'true'::jsonb or coalesce((p->>'available_cents')::numeric,0)<=0) then continue;end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('credit_id',c.id,'payer_id',c.payer_id,'payer_name',c.payer_name,'original_cents',p->'original_cents','applied_cents',p->'applied_cents','released_cents',p->'released_cents','available_cents',p->'available_cents','valid',p->'valid','revision',p->'revision','source_payment_id',c.payment_id,'created_at',c.created_at));
  end loop;
 elsif kind='targets' then
  p:=finance_private.customer_credit_position(_tenant_id,credit);
  if p->'valid'='true'::jsonb and (p->>'available_cents')::numeric>0 then
   for r in select * from public.receivables where tenant_id=_tenant_id and client_id=v_payer and status<>'cancelled' order by due_date nulls last,id loop
    s:=public._receivable_financial_snapshot(_tenant_id,r.id);label:=coalesce(nullif(s->>'reference',''),r.id::text);
    if s->'can_receive' is distinct from 'true'::jsonb or s->'requires_reconciliation' is distinct from 'false'::jsonb or (search<>'' and strpos(lower(label),lower(search))=0) then continue;end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('receivable_id',r.id,'payer_id',r.client_id,'reference',label,'status',r.status,'nominal_cents',s->>'amount_cents','cash_received_cents',s->>'cash_received_cents','credit_applied_cents',s->>'credit_applied_cents','settled_cents',s->>'settled_cents','open_cents',s->>'open_cents','revision',s->'revision'));
   end loop;
  end if;
 else
  p:=finance_private.customer_credit_position(_tenant_id,credit);
  for e in select a.*,coalesce(nullif(title_row.description,''),a.receivable_id::text) reference from finance_private.customer_credit_application_events a left join public.receivables title_row on title_row.tenant_id=a.tenant_id and title_row.id=a.receivable_id where a.tenant_id=_tenant_id and a.credit_id=credit and(search='' or strpos(lower(coalesce(title_row.description,'')),lower(search))>0 or strpos(lower(a.reason),lower(search))>0) order by a.created_at desc,a.id loop
   remaining:=null;ctx:=null;
   if e.action='apply' then
    select e.amount_cents-coalesce(sum(x.amount_cents),0) into remaining from finance_private.customer_credit_application_events x where x.tenant_id=_tenant_id and x.application_id=e.id and x.action='release';
    if remaining>0 and p->'valid'='true'::jsonb then ctx:=finance_private.customer_credit_application_context(_tenant_id,credit,e.receivable_id,remaining::text,e.id);end if;
   end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('id',e.id,'application_id',e.application_id,'credit_id',e.credit_id,'receivable_id',e.receivable_id,'reference',e.reference,'action',e.action,'amount_cents',e.amount_cents::text,'remaining_cents',remaining::text,'actor_id',e.actor_id,'actor_name',e.actor_name,'reason',e.reason,'observation_id',e.observation_id,'created_at',e.created_at,'can_release',coalesce(ctx->'eligible'='true'::jsonb,false)));
  end loop;
 end if;
 total:=jsonb_array_length(rows);if page_offset>total then raise exception 'finance_credit_catalog_offset_invalid' using errcode='22023';end if;
 revision:=md5(jsonb_build_object('tenant',_tenant_id,'actor',auth.uid(),'kind',kind,'credit',credit,'payer',v_payer,'search',search,'available_only',only_available,'rows',rows,'position_revision',p->'revision')::text);
 if _query->>'expected_revision' is not null and _query->>'expected_revision' is distinct from revision then raise exception 'finance_credit_catalog_changed' using errcode='40001';end if;
 select coalesce(jsonb_agg(value order by ordinal),'[]') into page from jsonb_array_elements(rows) with ordinality q(value,ordinal) where ordinal>page_offset and ordinal<=page_offset+page_limit;
 return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'kind',kind,'credit_id',credit,'payer_id',v_payer,'search',search,'available_only',only_available,'offset',page_offset,'limit',page_limit,'total',total,'next_offset',case when page_offset+page_limit<total then page_offset+page_limit end,'revision',revision,'rows',page,'can_execute',false);
end$$;
create function public.get_finance_customer_credit_options(_tenant_id uuid,_query jsonb) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.customer_credit_options(_tenant_id,_query)$$;

create function finance_private.dispatch_customer_credit_application(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform finance_private.require_access((_payload->>'tenant_id')::uuid);
 return finance_private.record_customer_credit_application(_payload);
end$$;
create function public.record_finance_customer_credit_application(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.dispatch_customer_credit_application(_payload)$$;
create function finance_private.preview_customer_credit_application(_tenant_id uuid,_credit_id uuid,_receivable_id uuid,_amount_cents text,_application_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;can_invoke boolean;begin
 perform finance_private.require_access(_tenant_id);
 v:=finance_private.customer_credit_application_context(_tenant_id,_credit_id,_receivable_id,_amount_cents,_application_id);
 if v->>'tenant_id' is distinct from _tenant_id::text or v->>'actor_id' is distinct from auth.uid()::text or v->>'credit_id' is distinct from _credit_id::text or v->>'receivable_id' is distinct from _receivable_id::text or v->>'amount_cents' is distinct from _amount_cents or v->>'application_id' is distinct from _application_id::text then raise exception 'finance_credit_preview_identity_invalid' using errcode='55000';end if;
 can_invoke:=has_function_privilege('authenticated','public.record_finance_customer_credit_application(jsonb)','execute') and has_function_privilege('authenticated','finance_private.dispatch_customer_credit_application(jsonb)','execute') and not has_function_privilege('authenticated','finance_private.record_customer_credit_application(jsonb)','execute') and not has_function_privilege('anon','finance_private.record_customer_credit_application(jsonb)','execute') and not has_function_privilege('service_role','finance_private.record_customer_credit_application(jsonb)','execute');
 return (v-'_evidence')||jsonb_build_object('credit',(v->'credit')-'history','can_execute',coalesce(v->'eligible'='true'::jsonb,false) and can_invoke);
end$$;
create function public.preview_finance_customer_credit_application(_tenant_id uuid,_credit_id uuid,_receivable_id uuid,_amount_cents text,_application_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.preview_customer_credit_application(_tenant_id,_credit_id,_receivable_id,_amount_cents,_application_id)$$;
revoke all on function finance_private.customer_credit_options(uuid,jsonb),public.get_finance_customer_credit_options(uuid,jsonb),finance_private.dispatch_customer_credit_application(jsonb),public.record_finance_customer_credit_application(jsonb),finance_private.preview_customer_credit_application(uuid,uuid,uuid,text,uuid),public.preview_finance_customer_credit_application(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.customer_credit_options(uuid,jsonb),public.get_finance_customer_credit_options(uuid,jsonb),finance_private.dispatch_customer_credit_application(jsonb),public.record_finance_customer_credit_application(jsonb),finance_private.preview_customer_credit_application(uuid,uuid,uuid,text,uuid),public.preview_finance_customer_credit_application(uuid,uuid,uuid,text,uuid) to authenticated;
