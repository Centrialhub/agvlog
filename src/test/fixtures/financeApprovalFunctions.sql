CREATE OR REPLACE FUNCTION finance_private.guard_payable_revision_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare protected boolean;ticket finance_private.payable_approval_tickets%rowtype;
begin
 if new.status is distinct from 'approved' or old.status='approved' then return new;end if;
 protected:=exists(select 1 from public.finance_expense_items e join finance_private.expense_open_complement_amendments a on a.tenant_id=e.tenant_id and a.expense_id=e.id where e.tenant_id=old.tenant_id and e.payable_id=old.id);
 if not protected and not exists(select 1 from finance_private.payable_approval_tickets t where t.transaction_id=txid_current() and t.tenant_id=old.tenant_id and t.payable_id=old.id) then return new;end if;
 if not pg_try_advisory_xact_lock(hashtextextended(old.tenant_id::text||':finance',0)) then raise exception 'finance_payable_approval_busy' using errcode='40001';end if;
 delete from finance_private.payable_approval_tickets t where t.transaction_id=txid_current() and t.tenant_id=old.tenant_id and t.payable_id=old.id and t.actor_id=auth.uid() and t.before_data=to_jsonb(old) and t.after_data=to_jsonb(new) returning * into ticket;
 if ticket.request_id is null or not finance_private.can_access(old.tenant_id) or (ticket.before_data-array['status','approved_at','approved_by','updated_at']) is distinct from (ticket.after_data-array['status','approved_at','approved_by','updated_at']) or new.approved_by is distinct from auth.uid() or new.approved_at is null then raise exception 'finance_payable_approval_revision_required' using errcode='55000';end if;
 return new;
end$function$;
CREATE OR REPLACE FUNCTION finance_private.approve_payable_revision(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t uuid;payable uuid;req uuid;actor uuid:=auth.uid();existing public.finance_commands%rowtype;p public.payables%rowtype;ctx jsonb;after_row jsonb;stamp timestamptz;result jsonb;event_id uuid:=gen_random_uuid();actor_name text;
begin
 if jsonb_typeof(payload) is distinct from 'object' or payload->'version' is distinct from '1'::jsonb or coalesce(payload->>'revision','')!~'^[a-f0-9]{32}$' or coalesce(payload->>'amount_cents','')!~'^[1-9][0-9]{0,13}$' or length(btrim(coalesce(payload->>'reason',''))) not between 10 and 2000 or exists(select 1 from jsonb_object_keys(payload)k where k<>all(array['version','tenant_id','request_id','payable_id','revision','amount_cents','reason'])) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(payload->>'tenant_id')::uuid;payable:=(payload->>'payable_id')::uuid;req:=(payload->>'request_id')::uuid;if t is null or payable is null or req is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform finance_private.require_access(t);perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;perform finance_private.require_access(t);
 select * into existing from public.finance_commands where tenant_id=t and request_id=req;if found then if existing.actor_id is distinct from actor or existing.action<>'approve_payable_revision' or existing.payload<>payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return existing.result;end if;
 select * into p from public.payables where tenant_id=t and id=payable for update nowait;if p.id is null then raise exception 'finance_payable_not_found' using errcode='22023';end if;
 perform finance_private.require_access(t);ctx:=finance_private.payable_approval_context(t,payable);
 if ctx->>'revision' is distinct from payload->>'revision' or ctx#>>'{obligation,amount_cents}' is distinct from payload->>'amount_cents' then raise exception 'finance_payable_approval_changed' using errcode='40001';end if;
 if ctx->>'eligible' is distinct from 'true' then raise exception 'finance_payable_not_approvable' using errcode='55000';end if;
 stamp:=clock_timestamp();after_row:=to_jsonb(p)||jsonb_build_object('status','approved','approved_at',stamp,'approved_by',actor,'updated_at',stamp);
 perform finance_private.assert_closed_source_mutable(t,'payables',after_row);
 insert into finance_private.payable_approval_tickets values(txid_current(),t,payable,actor,req,to_jsonb(p),after_row);
 update public.payables set status='approved',approved_at=stamp,approved_by=actor,updated_at=stamp where tenant_id=t and id=payable;
 if exists(select 1 from finance_private.payable_approval_tickets where transaction_id=txid_current() and tenant_id=t and payable_id=payable) then raise exception 'finance_payable_approval_ticket_unconsumed' using errcode='55000';end if;
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where id=actor;
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',actor,'request_id',req,'payable_id',payable,'approval_event_id',event_id,'confirmed',true,'amount_cents',payload->>'amount_cents','status','approved','approved_at',stamp,'cost_revision',ctx#>>'{cost_origin,revision}','cash_changed',false);
 insert into public.finance_events(id,tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(event_id,t,'payable',payable,'payable_approved_with_revision',actor,actor_name,btrim(payload->>'reason'),ctx-'_evidence',result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'approve_payable_revision',payload,result);return result;
exception when lock_not_available then raise exception 'finance_payable_approval_busy' using errcode='40001';end$function$;
CREATE OR REPLACE FUNCTION finance_private.dispatch_payable_revision_approval(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin perform finance_private.require_access((_payload->>'tenant_id')::uuid);return finance_private.approve_payable_revision(_payload);end$function$;
CREATE OR REPLACE FUNCTION public.approve_finance_payable(_payload jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select finance_private.dispatch_payable_revision_approval(_payload)$function$;
CREATE OR REPLACE FUNCTION finance_private.preview_payable_revision_approval(_tenant_id uuid, _payable_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$declare value jsonb;capable boolean;begin
 perform finance_private.require_access(_tenant_id);value:=finance_private.payable_approval_context(_tenant_id,_payable_id);
 if value->>'tenant_id' is distinct from _tenant_id::text or value->>'payable_id' is distinct from _payable_id::text or value->>'actor_id' is distinct from auth.uid()::text then raise exception 'finance_payable_approval_identity_invalid' using errcode='55000';end if;
 capable:=has_function_privilege('authenticated','public.approve_finance_payable(jsonb)','execute') and has_function_privilege('authenticated','finance_private.dispatch_payable_revision_approval(jsonb)','execute') and not has_function_privilege('authenticated','finance_private.approve_payable_revision(jsonb)','execute') and not has_function_privilege('anon','finance_private.approve_payable_revision(jsonb)','execute') and not has_function_privilege('service_role','finance_private.approve_payable_revision(jsonb)','execute');
 return(value-'_evidence')||jsonb_build_object('can_execute',value->>'eligible'='true' and value->>'can_approve'='true' and capable);end$function$;
CREATE OR REPLACE FUNCTION public.preview_finance_payable_approval(_tenant_id uuid, _payable_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$select finance_private.preview_payable_revision_approval(_tenant_id,_payable_id)$function$;
