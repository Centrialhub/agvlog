-- Candidate only. Predecessor pins and integrated payroll proof must be finalized before promotion.
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$declare x record;p record;begin for x in select * from(values ('finance_private.apply_payable_movement(jsonb)','dbaee46db1c24aac9fcf8e604b946d22','{postgres=X/postgres,authenticated=X/postgres}','search_path=""','v'),('finance_private.approve_payable_revision(jsonb)','178c5d334368ee2fcd4d9c7ff9910504','{postgres=X/postgres}','search_path=""','v'),('finance_private.paid_projection_chain(uuid,text,uuid)','3f8f086b42fbbda71ee22f02ee46bc58','{postgres=X/postgres}','search_path=""','s'),('public.register_employee_advance(uuid,uuid,numeric,date,text,text,text,boolean,boolean)','27dcd646b5076a6fc8f91039ca7e3084','{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}','search_path=public','v'),('public.sync_employee_advance_from_payable()','4aec41fe633b2f1d4b5eb36b1ceb3b59','{postgres=X/postgres,service_role=X/postgres}','search_path=public','v'))v(signature,hash,acl,config,volatility) loop select * into p from pg_proc where oid=to_regprocedure(x.signature);if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from x.hash or not p.prosecdef or p.provolatile::text is distinct from x.volatility or p.proacl::text is distinct from x.acl or p.proconfig is distinct from array[x.config]::text[] then raise exception 'finance_advance_predecessor_changed:%',x.signature using errcode='55000';end if;end loop;end$preflight$;


create function finance_private.employee_advance_position(t uuid, advance uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.employee_advances%rowtype;e public.employees%rowtype;p public.payables%rowtype;proof jsonb;issues text[]:='{}';paid bigint:=0;amount bigint;footprints jsonb:='[]';r record;revision text;
begin
 select * into a from public.employee_advances where tenant_id=t and id=advance;
 select * into e from public.employees where tenant_id=t and id=a.employee_id;
 if a.id is null then raise exception 'finance_advance_not_found' using errcode='22023';end if;
 if e.id is null or e.driver_id is distinct from a.driver_id then issues:=array_append(issues,'finance_advance_employee_mismatch');end if;
 if not coalesce(a.amount>0 and a.amount*100=trunc(a.amount*100) and a.amount*100<=99999999999999,false) then issues:=array_append(issues,'finance_advance_amount_invalid');else amount:=(a.amount*100)::bigint;end if;
 if a.financial_obligation_id is not null then issues:=array_append(issues,'finance_advance_obligation_requires_review');end if;
 if a.payable_id is null then
  if exists(select 1 from public.payables where tenant_id=t and source_table='employee_advances' and source_id=a.id) then issues:=array_append(issues,'finance_advance_title_unlinked');end if;
  if a.status='paid' then issues:=array_append(issues,'finance_advance_paid_without_evidence');end if;
 else
  select * into p from public.payables where tenant_id=t and id=a.payable_id;
  if p.id is null or p.source_table is distinct from 'employee_advances' or p.source_id is distinct from a.id or p.amount is distinct from a.amount or p.driver_id is distinct from a.driver_id or p.source_metadata->>'employee_id' is distinct from a.employee_id::text then issues:=array_append(issues,'finance_advance_title_chain_invalid');end if;
  proof:=finance_private.payable_portfolio_evidence(t,a.payable_id);
  if proof->>'valid' is distinct from 'true' then issues:=array_append(issues,'finance_advance_payment_evidence_invalid');else paid:=(proof->>'paid_cents')::bigint;end if;
  for r in select pp.id payment_id,pp.amount,l.id link_id,m.* from finance_private.active_payable_payments pp
   left join public.finance_payable_movement_links l on l.tenant_id=t and l.payment_id=pp.id and not exists(select 1 from public.finance_payable_link_reversals x where x.tenant_id=t and x.link_id=l.id)
   left join public.finance_movements m on m.tenant_id=t and m.id=l.movement_id where pp.tenant_id=t and pp.payable_id=a.payable_id loop
   if r.link_id is null or r.driver_id is distinct from a.driver_id then issues:=array_append(issues,'finance_advance_payment_identity_invalid');end if;
   footprints:=footprints||jsonb_build_array(jsonb_build_object('payment_id',r.payment_id,'link_id',r.link_id,'movement_id',r.id,'account_id',r.bank_account_id,'amount_cents',trunc(r.amount*100)::text,'occurred_on',r.occurred_on));
  end loop;
 end if;
 if a.status='paid' and paid is distinct from amount then issues:=array_append(issues,'finance_advance_paid_without_full_payment');end if;
 if a.status='cancelled' and paid>0 then issues:=array_append(issues,'finance_advance_cancelled_with_payment');end if;
 revision:=md5(jsonb_build_object('advance',to_jsonb(a),'employee',to_jsonb(e),'title',to_jsonb(p),'payment_proof',proof)::text);
 return jsonb_build_object('version',1,'tenant_id',t,'advance_id',a.id,'employee_id',a.employee_id,'employee_name',e.name,'employee_document',e.doc_cpf,'driver_id',a.driver_id,'status',a.status,'payable_id',a.payable_id,'payable_status',p.status,'verified',cardinality(issues)=0,'issues',to_jsonb(issues),'revision',revision,
 'amount_cents',case when cardinality(issues)=0 then amount::text end,'paid_cents',case when cardinality(issues)=0 then paid::text end,'open_cents',case when cardinality(issues)=0 then (case when a.status='cancelled' then 0 else amount-paid end)::text end,'footprints',footprints);
end$$;
revoke all on function finance_private.employee_advance_position(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.employee_advance_payment_context(t uuid,advance uuid,movement uuid,amount text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare pos jsonb;m public.finance_movements%rowtype;available bigint;issues text[]:='{}';capable boolean;fingerprint text;doc text;identity_ok boolean:=false;selected bigint;
begin
 perform finance_private.require_access(t);pos:=finance_private.employee_advance_position(t,advance);
 capable:=exists(select 1 from public.tenant_memberships where tenant_id=t and user_id=auth.uid() and active and role::text in('owner','admin'));
 if not capable then issues:=array_append(issues,'finance_advance_manager_required');end if;
 if pos->>'verified' is distinct from 'true' then issues:=array_append(issues,'finance_advance_source_invalid');end if;
 if pos->>'status' not in('pending','approved') then issues:=array_append(issues,'finance_advance_not_payable');end if;
 if amount is null or amount!~'^[1-9][0-9]{0,13}$' then issues:=array_append(issues,'finance_advance_payment_amount_invalid');else selected:=amount::bigint;end if;
 select * into m from public.finance_movements where tenant_id=t and id=movement;
 if m.id is null then issues:=array_append(issues,'finance_advance_movement_required');else
  available:=m.amount_cents-finance_private.movement_used_cents(t,m.id);
  doc:=nullif(regexp_replace(coalesce(pos->>'employee_document',''),'[^0-9]','','g'),'');
  identity_ok:=m.driver_id is not distinct from (pos->>'driver_id')::uuid and case when doc is not null then doc=regexp_replace(coalesce(m.beneficiary_document,''),'[^0-9]','','g') else lower(btrim(m.beneficiary_name))=lower(btrim(pos->>'employee_name')) end;
  if not identity_ok then issues:=array_append(issues,'finance_advance_beneficiary_mismatch');end if;
  if m.direction<>'out' or m.nature not in('payment','driver_advance','other') or not isfinite(m.occurred_on) or exists(select 1 from public.finance_movement_voids where tenant_id=t and movement_id=m.id) then issues:=array_append(issues,'finance_advance_movement_invalid');end if;
  if available<selected then issues:=array_append(issues,'finance_advance_movement_capacity');end if;
 end if;
 if selected>(pos->>'open_cents')::bigint then issues:=array_append(issues,'finance_advance_exceeds_open');end if;
 fingerprint:=md5(jsonb_build_object('position',pos,'movement',to_jsonb(m),'available',available,'amount',amount)::text);
 return jsonb_build_object('version',1,'tenant_id',t,'actor_id',auth.uid(),'advance_id',advance,'movement_id',movement,'amount_cents',amount,'revision',fingerprint,'eligible',cardinality(issues)=0,'can_pay',capable,'can_execute',false,'blockers',to_jsonb(issues),'advance',pos,
 'movement',case when m.id is not null then jsonb_build_object('id',m.id,'bank_account_id',m.bank_account_id,'occurred_on',m.occurred_on,'beneficiary_name',m.beneficiary_name,'beneficiary_document',m.beneficiary_document,'amount_cents',m.amount_cents::text,'available_cents',case when available>=0 then available::text end,'identity_verified',identity_ok) end,
 'effects',jsonb_build_object('cash_created',false,'expense_created',false,'create_payable',pos->>'payable_id' is null,'approve_payable',coalesce(pos->>'payable_status','pending') in('pending','overdue'),'paid_before_cents',pos->>'paid_cents','paid_after_cents',case when selected is not null and pos->>'verified'='true' then ((pos->>'paid_cents')::bigint+selected)::text end,'open_after_cents',case when selected is not null and pos->>'verified'='true' and selected<=(pos->>'open_cents')::bigint then ((pos->>'open_cents')::bigint-selected)::text end));
end$$;
revoke all on function finance_private.employee_advance_payment_context(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;

create function finance_private.guard_employee_advance_paid_evidence() returns trigger language plpgsql security definer set search_path='' as $$
declare pos jsonb;a public.employee_advances%rowtype;
begin
 select * into a from public.employee_advances where tenant_id=new.tenant_id and id=new.id;
 if a.status='paid' then
  pos:=finance_private.paid_projection_chain(a.tenant_id,'employee_advances',a.id);
  if pos->>'valid' is distinct from 'true' then raise exception 'finance_advance_payment_requires_evidence' using errcode='23514';end if;
 end if;return null;
end$$;
revoke all on function finance_private.guard_employee_advance_paid_evidence() from public,anon,authenticated,service_role;
create constraint trigger finance_employee_advance_paid_evidence after insert or update on public.employee_advances deferrable initially deferred for each row execute function finance_private.guard_employee_advance_paid_evidence();

create function finance_private.record_employee_advance_payment(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;req uuid;aid uuid;mid uuid;actor uuid:=auth.uid();a public.employee_advances%rowtype;e public.employees%rowtype;p public.payables%rowtype;old public.finance_commands%rowtype;ctx jsonb;ap jsonb;pay jsonb;pos jsonb;result jsonb;name text;amount bigint;
begin
 if jsonb_typeof(payload) is distinct from 'object' or payload->'version' is distinct from '1'::jsonb or coalesce(payload->>'amount_cents','')!~'^[1-9][0-9]{0,13}$' or coalesce(payload->>'expected_revision','')!~'^[a-f0-9]{32}$' or length(btrim(coalesce(payload->>'reason',''))) not between 10 and 2000 or coalesce(payload->>'method','') not in('pix','boleto','ted','doc','dinheiro','cartao','debito_automatico','other') or exists(select 1 from jsonb_object_keys(payload)k where k<>all(array['version','tenant_id','request_id','advance_id','movement_id','amount_cents','expected_revision','method','reason'])) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(payload->>'tenant_id')::uuid;req:=(payload->>'request_id')::uuid;aid:=(payload->>'advance_id')::uuid;mid:=(payload->>'movement_id')::uuid;amount:=(payload->>'amount_cents')::bigint;
 if t is null or req is null or aid is null or mid is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform finance_private.require_access(t);perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;perform finance_private.require_access(t);
 if not exists(select 1 from public.tenant_memberships where tenant_id=t and user_id=actor and active and role::text in('owner','admin')) then raise exception 'finance_advance_manager_required' using errcode='42501';end if;
 select * into old from public.finance_commands where tenant_id=t and request_id=req;
 if found then if old.actor_id is distinct from actor or old.action<>'employee_advance_payment' or old.payload<>payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return old.result;end if;
 select * into a from public.employee_advances where tenant_id=t and id=aid for update nowait;
 select * into e from public.employees where tenant_id=t and id=a.employee_id for share nowait;
 perform 1 from public.finance_movements where tenant_id=t and id=mid for update nowait;
 if a.payable_id is not null then perform 1 from public.payables where tenant_id=t and id=a.payable_id for update nowait;end if;
 ctx:=finance_private.employee_advance_payment_context(t,aid,mid,payload->>'amount_cents');
 if ctx->>'revision' is distinct from payload->>'expected_revision' then raise exception 'finance_advance_revision_changed' using errcode='40001';end if;
 if ctx->>'eligible' is distinct from 'true' then raise exception 'finance_advance_payment_ineligible' using errcode='55000';end if;
 perform finance_private.assert_closed_source_mutable(t,'employee_advances',to_jsonb(a));
 if a.payable_id is null then
  insert into public.payables(tenant_id,supplier_name,category,description,amount,competence_date,due_date,driver_id,status,created_by,source_table,source_id,source_metadata)
  values(t,e.name,case when a.driver_id is null then 'payroll' else 'driver_advance' end,'Adiantamento — '||e.name,a.amount,a.advance_date,a.advance_date,a.driver_id,'pending',actor,'employee_advances',a.id,jsonb_build_object('employee_id',a.employee_id,'driver_id',a.driver_id,'advance_date',a.advance_date,'reason',a.reason)) returning id into a.payable_id;
  update public.employee_advances set payable_id=a.payable_id where tenant_id=t and id=aid;
 end if;
 select * into p from public.payables where tenant_id=t and id=a.payable_id;
 if p.status in('pending','overdue') then
  ap:=finance_private.payable_approval_context(t,p.id);
  perform finance_private.approve_payable_revision(jsonb_build_object('version',1,'tenant_id',t,'request_id',md5(req::text||':approval')::uuid,'payable_id',p.id,'revision',ap->>'revision','amount_cents',trunc(p.amount*100)::text,'reason',payload->>'reason'));
 end if;
 update public.employee_advances set status='approved',approved_by=coalesce(approved_by,actor),approved_at=coalesce(approved_at,clock_timestamp()),updated_at=clock_timestamp() where tenant_id=t and id=aid and status='pending';
 pay:=finance_private.apply_payable_movement(jsonb_build_object('version',1,'tenant_id',t,'request_id',md5(req::text||':payment')::uuid,'payable_id',p.id,'movement_id',mid,'amount_cents',payload->>'amount_cents','method',payload->>'method','reason',payload->>'reason'));
 update public.employee_advances set paid_by=actor where tenant_id=t and id=aid and status='paid';
 pos:=finance_private.employee_advance_position(t,aid);
 if pos->>'verified' is distinct from 'true' or (pos->>'paid_cents')::bigint is distinct from (ctx#>>'{advance,paid_cents}')::bigint+amount then raise exception 'finance_advance_payment_postcondition' using errcode='23514';end if;
 result:=jsonb_build_object('version',1,'confirmed',true,'tenant_id',t,'actor_id',actor,'request_id',req,'advance_id',aid,'payable_id',p.id,'payment_id',pay->'payment_id','link_id',pay->'link_id','movement_id',mid,'amount_cents',payload->>'amount_cents','status',pos->>'status','paid_cents',pos->>'paid_cents','open_cents',pos->>'open_cents','cash_created',false,'expense_created',false);
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into name from auth.users where id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'employee_advance',aid,'employee_advance_payment_applied',actor,coalesce(name,actor::text),payload->>'reason',ctx,result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'employee_advance_payment',payload,result);
 perform finance_private.require_access(t);return result;
exception when lock_not_available then raise exception 'finance_advance_busy' using errcode='40001';end$$;
revoke all on function finance_private.record_employee_advance_payment(jsonb) from public,anon,authenticated,service_role;

create function finance_private.employee_advance_payment_options(t uuid,advance uuid,query jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare pos jsonb;allrows jsonb;revision text;ofs integer:=coalesce((query->>'offset')::integer,0);lim integer:=coalesce((query->>'limit')::integer,30);search text:=coalesce(query->>'search','');total integer;
begin
 perform finance_private.require_access(t);pos:=finance_private.employee_advance_position(t,advance);
 if jsonb_typeof(query) is distinct from 'object' or ofs<0 or lim not between 1 and 100 or length(search)>200 or exists(select 1 from jsonb_object_keys(query)k where k<>all(array['offset','limit','search','expected_revision'])) then raise exception 'finance_invalid_query' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'bank_account_id',m.bank_account_id,'account_name',b.name,'occurred_on',m.occurred_on,'beneficiary_name',m.beneficiary_name,'beneficiary_document',m.beneficiary_document,'description',m.description,'amount_cents',m.amount_cents::text,'available_cents',(m.amount_cents-finance_private.movement_used_cents(t,m.id))::text,'identity_verified',true) order by m.occurred_on desc,m.id),'[]') into allrows
 from public.finance_movements m join public.bank_accounts b on b.tenant_id=t and b.id=m.bank_account_id
 where m.tenant_id=t and m.direction='out' and m.nature in('payment','driver_advance','other') and isfinite(m.occurred_on) and m.driver_id is not distinct from (pos->>'driver_id')::uuid
 and not exists(select 1 from public.finance_movement_voids v where v.tenant_id=t and v.movement_id=m.id)
 and m.amount_cents>finance_private.movement_used_cents(t,m.id)
 and case when nullif(regexp_replace(coalesce(pos->>'employee_document',''),'[^0-9]','','g'),'') is not null then regexp_replace(m.beneficiary_document,'[^0-9]','','g')=regexp_replace(pos->>'employee_document','[^0-9]','','g') else lower(btrim(m.beneficiary_name))=lower(btrim(pos->>'employee_name')) end
 and position(lower(search) in lower(concat_ws(' ',m.description,m.beneficiary_name,m.beneficiary_document,b.name)))>0;
 total:=jsonb_array_length(allrows);revision:=md5(jsonb_build_object('position',pos,'rows',allrows,'search',search)::text);
 if query->>'expected_revision' is not null and query->>'expected_revision'<>revision then raise exception 'finance_advance_options_changed' using errcode='40001';end if;
 if ofs>total then raise exception 'finance_invalid_offset' using errcode='22023';end if;
 return jsonb_build_object('version',1,'tenant_id',t,'actor_id',auth.uid(),'advance_id',advance,'offset',ofs,'limit',lim,'total',total,'next_offset',case when ofs+lim<total then ofs+lim end,'revision',revision,'rows',(select coalesce(jsonb_agg(value order by ordinal),'[]') from jsonb_array_elements(allrows) with ordinality x(value,ordinal) where ordinal>ofs and ordinal<=ofs+lim));
end$$;
revoke all on function finance_private.employee_advance_payment_options(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function finance_private.employee_advance_payment_history(t uuid,advance uuid,query jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare allrows jsonb;revision text;ofs integer:=coalesce((query->>'offset')::integer,0);lim integer:=coalesce((query->>'limit')::integer,30);total integer;
begin
 perform finance_private.require_access(t);perform finance_private.employee_advance_position(t,advance);
 if jsonb_typeof(query) is distinct from 'object' or ofs<0 or lim not between 1 and 100 or exists(select 1 from jsonb_object_keys(query)k where k<>all(array['offset','limit','expected_revision'])) then raise exception 'finance_invalid_query' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('request_id',request_id,'actor_id',actor_id,'created_at',c.created_at,'reason',c.payload->>'reason','actor_name',(select e.actor_name from public.finance_events e where e.tenant_id=t and e.action='employee_advance_payment_applied' and e.after_data->>'request_id'=c.request_id::text order by e.id limit 1),'result',c.result) order by c.created_at,c.request_id),'[]') into allrows from public.finance_commands c where tenant_id=t and action='employee_advance_payment' and result->>'advance_id'=advance::text;
 total:=jsonb_array_length(allrows);revision:=md5(allrows::text);
 if query->>'expected_revision' is not null and query->>'expected_revision'<>revision then raise exception 'finance_advance_history_changed' using errcode='40001';end if;
 if ofs>total then raise exception 'finance_invalid_offset' using errcode='22023';end if;
 return jsonb_build_object('version',1,'tenant_id',t,'actor_id',auth.uid(),'advance_id',advance,'offset',ofs,'limit',lim,'total',total,'next_offset',case when ofs+lim<total then ofs+lim end,'revision',revision,'rows',(select coalesce(jsonb_agg(value order by ordinal),'[]') from jsonb_array_elements(allrows) with ordinality x(value,ordinal) where ordinal>ofs and ordinal<=ofs+lim));
end$$;
revoke all on function finance_private.employee_advance_payment_history(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
