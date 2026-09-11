set local lock_timeout='3s';
set local statement_timeout='30s';
-- Private integrated extinction; no grants or public promotion.
do $pins$ declare s record;p record;begin
 for s in select * from(values
('finance_private.expense_cost_before_returns(uuid,uuid)','e0328bd06900f17657a6bbc985f491fa'),
('finance_private.expense_cost_funding(uuid,uuid)','18ce78f3207d8f334f05c930d7434c30'),
('finance_private.guard_effective_unloading_cost()','fd0ba9ed44140afda72e537254a2ec8a'),
('finance_private.expense_cost_effective(uuid,uuid)','03dc3252d3f8dfaefcf1c0dc789d1e73'),
('finance_private.guard_open_complement_source()','712031e564fac4d33c4f56f591ad2cdd'),
('finance_private.unloading_open_complement_context(uuid,uuid,text)','e2a3c0217730b6e354aba59be90418fb'),
('finance_private.correct_unloading_open_complement(jsonb)','d4444827f2e0140018a248c26a6df0c9'),
('finance_private.expense_cost_coverage(uuid,uuid)','8c9ee6819131d28a86b015d234dfe4ef'),
('finance_private.guard_payable_revision_approval()','b221a4388773b4f9de274025249825e7'))v(signature,hash) loop
 select * into p from pg_proc where oid=to_regprocedure(s.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from s.hash or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner) then raise exception 'finance_complement_extinction_predecessor_changed:%',s.signature using errcode='55000';end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.payables'::regclass and tgname='finance_effective_unloading_payable' and tgfoid='finance_private.guard_effective_unloading_cost()'::regprocedure and tgtype=23 and tgenabled='O' and tgqual is null and tgnargs=0)
 or not exists(select 1 from pg_trigger where tgrelid='public.payables'::regclass and tgname='a_payable_revision_approval' and tgfoid='finance_private.guard_payable_revision_approval()'::regprocedure and tgtype=19 and tgenabled='O' and tgqual is null and tgnargs=0)
 then raise exception 'finance_complement_extinction_guard_changed' using errcode='55000';end if;
 execute replace(pg_get_functiondef('finance_private.expense_cost_before_returns(uuid,uuid)'::regprocedure),'finance_private.expense_cost_before_returns(', 'finance_private.cost_before_extinction_returns(');
end$pins$;
revoke all on function finance_private.cost_before_extinction_returns(uuid,uuid) from public,anon,authenticated,service_role;
create table finance_private.open_complement_extinctions(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,expense_id uuid not null,charge_id uuid not null,payable_id uuid not null,regularization_id uuid not null unique,
 request_id uuid not null,actor_id uuid not null,actor_name text,reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp(),
 revision_before text not null,cost_before jsonb not null,before_payable jsonb not null,after_payable jsonb not null,source_snapshot jsonb not null,proposal jsonb not null,
 unique(tenant_id,expense_id),unique(tenant_id,request_id),foreign key(tenant_id,expense_id) references public.finance_expense_items(tenant_id,id),
 foreign key(tenant_id,expense_id,regularization_id) references finance_private.expense_cost_regularizations(tenant_id,expense_id,id) deferrable initially deferred
);
alter table finance_private.open_complement_extinctions enable row level security;
revoke all on finance_private.open_complement_extinctions from public,anon,authenticated,service_role;
create trigger preserve_complement_extinction before update or delete on finance_private.open_complement_extinctions for each row execute function finance_private.preserve_event();
create or replace function finance_private.open_complement_before_extinction(t uuid,expense uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb;source jsonb;p public.payables%rowtype;x finance_private.expense_open_complement_amendments%rowtype;rev text;amount bigint;previous uuid;ordinal integer:=0;ok boolean;history jsonb:='[]';latest jsonb;
begin
 base:=finance_private.expense_cost_amended_base(t,expense)||jsonb_build_object('regularization',null);rev:=base->>'revision';amount:=(base->>'effective_amount_cents')::bigint;ok:=coalesce(base->>'verified'='true',false);
 if not exists(select 1 from finance_private.expense_open_complement_amendments a where a.tenant_id=t and a.expense_id=expense) then return base||jsonb_build_object('open_complement',null);end if;
 source:=finance_private.open_complement_source(t,expense);select * into p from public.payables where tenant_id=t and id=(base->>'payable_id')::uuid; select (jsonb_populate_record(null::public.payables,closing.before_payable)).* into p from finance_private.open_complement_extinctions closing where closing.tenant_id=t and closing.expense_id=expense;
 for x in select * from finance_private.expense_open_complement_amendments a where a.tenant_id=t and a.expense_id=expense order by a.ordinal loop
  if x.ordinal<>ordinal+1 or x.previous_id is distinct from previous or x.revision_before is distinct from rev or x.base_revision is distinct from base->>'revision' or x.before_cost_cents is distinct from amount or x.source_snapshot is distinct from source or source->>'verified' is distinct from 'true' or x.allocated_cents::text is distinct from source->>'allocated_cents' or x.charge_id::text is distinct from base->>'charge_id' or x.payable_id::text is distinct from base->>'payable_id'
   or (x.before_payable-array['amount','status','updated_at']) is distinct from (x.after_payable-array['amount','status','updated_at']) or coalesce(x.before_payable->>'status','') not in('pending','approved') or x.after_payable->>'id' is distinct from x.payable_id::text or x.after_payable->>'tenant_id' is distinct from t::text or x.after_payable->>'source_id' is distinct from expense::text or x.after_payable->>'source_table' is distinct from 'finance_expense_items' or x.after_payable->>'status' is distinct from 'pending' or finance_private.unloading_repair_cents(x.before_payable->'amount') is distinct from (x.before_cost_cents-x.allocated_cents)::text or finance_private.unloading_repair_cents(x.after_payable->'amount') is distinct from (x.after_cost_cents-x.allocated_cents)::text
   or not exists(select 1 from public.finance_commands c where c.tenant_id=t and c.request_id=x.request_id and c.actor_id=x.actor_id and c.action='correct_open_unloading_complement' and c.result->>'amendment_id'=x.id::text and c.payload->>'expense_id'=expense::text and c.payload->>'amount_cents'=x.after_cost_cents::text and c.payload->>'charge_id'=x.charge_id::text and c.payload->>'payable_id'=x.payable_id::text and c.result->>'request_id'=x.request_id::text and c.result#>>'{effects,cost_before_cents}'=x.before_cost_cents::text and c.result#>>'{effects,cost_after_cents}'=x.after_cost_cents::text and c.result#>>'{effects,complement_after_cents}'=(x.after_cost_cents-x.allocated_cents)::text)
   or not exists(select 1 from public.finance_events a where a.tenant_id=t and a.entity_id=expense and a.actor_id=x.actor_id and a.action='unloading_open_complement_corrected' and a.after_data->>'amendment_id'=x.id::text and a.after_data#>>'{effects,cost_after_cents}'=x.after_cost_cents::text and a.before_data#>'{_evidence,source}'=x.source_snapshot)
  then ok:=false;end if;
  rev:=md5(jsonb_build_object('previous',rev,'event',to_jsonb(x))::text);amount:=x.after_cost_cents;previous:=x.id;ordinal:=x.ordinal;
  latest:=jsonb_build_object('id',x.id,'ordinal',x.ordinal,'previous_id',x.previous_id,'request_id',x.request_id,'actor_id',x.actor_id,'actor_name',x.actor_name,'reason',x.reason,'created_at',x.created_at,'cost_before_cents',x.before_cost_cents::text,'cost_after_cents',x.after_cost_cents::text,'complement_before_cents',(x.before_cost_cents-x.allocated_cents)::text,'complement_after_cents',(x.after_cost_cents-x.allocated_cents)::text,'allocated_reserved_cents',x.allocated_cents::text,'approval_reset',x.before_payable->>'status'='approved','revision_after',rev);history:=history||jsonb_build_array(latest);
 end loop;
 if p.id is null or finance_private.unloading_repair_cents(to_jsonb(p)->'amount') is distinct from (amount-(source->>'allocated_cents')::bigint)::text or p.source_table is distinct from 'finance_expense_items' or p.source_id is distinct from expense or (to_jsonb(p)-array['amount','status','updated_at','paid_amount','paid_at','bank_account_id','approved_at','approved_by']) is distinct from (x.after_payable-array['amount','status','updated_at','paid_amount','paid_at','bank_account_id','approved_at','approved_by']) then ok:=false;end if;
 return base||jsonb_build_object('verified',ok,'issue',case when ok then null else 'finance_open_complement_chain_invalid' end,'effective_amount_cents',case when ok then amount::text end,'revision',rev,'open_complement',latest||jsonb_build_object('history',history));
end$$;

create or replace function finance_private.expense_cost_before_returns(t uuid,expense uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare x finance_private.open_complement_extinctions%rowtype;r finance_private.expense_cost_regularizations%rowtype;p public.payables%rowtype;base jsonb;source jsonb;funding jsonb;ds jsonb;gross bigint;applied bigint;residual bigint;ok boolean;rev text;reg jsonb;
begin
 select * into x from finance_private.open_complement_extinctions where tenant_id=t and expense_id=expense;
 if not found then return finance_private.cost_before_extinction_returns(t,expense);end if;
 base:=finance_private.open_complement_before_extinction(t,expense);source:=finance_private.open_complement_source(t,expense);funding:=finance_private.expense_cost_funding(t,expense);
 select * into p from public.payables where tenant_id=t and id=x.payable_id;
 select * into r from finance_private.expense_cost_regularizations where tenant_id=t and id=x.regularization_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'source_kind',d.source_kind,'source_id',d.source_id,'movement_id',d.movement_id,'payment_id',d.payment_id,'gross_reserved_cents',d.gross_reserved_cents::text,'applied_cents',d.applied_cents::text,'residual_cents',d.residual_cents::text,'disposition_type',d.disposition_type,'responsible_type',d.responsible_type,'responsible_id',d.responsible_id,'responsible_name',d.responsible_name,'status','pending') order by d.source_kind,d.source_id),'[]'),coalesce(sum(d.gross_reserved_cents),0),coalesce(sum(d.applied_cents),0),coalesce(sum(d.residual_cents),0) into ds,gross,applied,residual from finance_private.expense_cost_dispositions d where d.tenant_id=t and d.regularization_id=r.id;
 ok:=base->>'verified'='true' and base=x.cost_before and source=x.source_snapshot and source->>'verified'='true' and funding->>'verified'='true'
 and x.charge_id::text=base->>'charge_id' and x.payable_id::text=base->>'payable_id' and x.expense_id::text=base->>'expense_id' and x.tenant_id::text=base->>'tenant_id'
 and to_jsonb(p)=x.after_payable and x.after_payable->>'status'='cancelled' and x.before_payable->>'status' in('pending','approved')
 and (x.before_payable-array['status','updated_at'])=(x.after_payable-array['status','updated_at'])
 and finance_private.unloading_repair_cents(x.before_payable->'amount')=((base->>'effective_amount_cents')::bigint-gross)::text
 and r.ordinal=1 and r.previous_id is null and r.before_cents::text=base->>'effective_amount_cents' and r.after_cents::text=x.proposal->>'amount_cents'
 and r.revision_before=base->>'revision' and r.base_revision=base->>'revision' and r.source_snapshot=funding and r.proposal=x.proposal and r.request_id=x.request_id and r.actor_id=x.actor_id and r.expense_id=x.expense_id and r.charge_id=x.charge_id and r.payable_id=x.payable_id
 and gross::text=source->>'allocated_cents' and applied=r.after_cents and residual=gross-applied and residual>=0 and jsonb_array_length(ds)=jsonb_array_length(funding->'rows')
 and (select count(*) from finance_private.expense_cost_regularizations q where q.tenant_id=t and q.expense_id=expense)=1
 and not exists(select 1 from public.payables_payments pp where pp.tenant_id=t and pp.payable_id=p.id)
 and not exists(select 1 from jsonb_array_elements(ds)d where not exists(select 1 from jsonb_array_elements(funding->'rows')s where s->>'source_kind'='expense_allocation' and s->>'source_id'=d->>'source_id' and s->>'movement_id'=d->>'movement_id' and s->>'gross_reserved_cents'=d->>'gross_reserved_cents' and s->>'responsible_id'=d->>'responsible_id' and s->>'disposition_type'=d->>'disposition_type' and s->>'responsible_type'=d->>'responsible_type'))
 and not exists(select 1 from jsonb_array_elements(ds)d where not exists(select 1 from jsonb_array_elements(x.proposal->'dispositions')s where s->>'source_id'=d->>'source_id' and s->>'applied_cents'=d->>'applied_cents' and s->>'responsible_id'=d->>'responsible_id' and s->>'source_kind'=d->>'source_kind' and s->>'disposition_type'=d->>'disposition_type'))
 and exists(select 1 from public.finance_commands c where c.tenant_id=t and c.request_id=x.request_id and c.actor_id=x.actor_id and c.action='extinguish_open_unloading_complement' and c.payload->>'expense_id'=expense::text and c.payload->>'payable_id'=p.id::text and c.payload->>'charge_id'=x.charge_id::text and c.payload->'proposal'=x.proposal and c.payload->>'revision'=x.revision_before and c.result->>'extinction_id'=x.id::text and c.result->>'regularization_id'=r.id::text)
 and exists(select 1 from public.finance_events e where e.tenant_id=t and e.entity_id=expense and e.actor_id=x.actor_id and e.action='unloading_open_complement_extinguished' and e.before_data->'cost_origin'=x.cost_before and e.before_data->>'revision'=x.revision_before and e.before_data#>'{_evidence,source}'=x.source_snapshot and e.after_data->>'extinction_id'=x.id::text);
 rev:=md5(jsonb_build_object('before',base->>'revision','extinction',to_jsonb(x),'regularization',to_jsonb(r),'dispositions',ds)::text);
 reg:=jsonb_build_object('id',r.id,'ordinal',1,'previous_id',null,'request_id',x.request_id,'actor_id',x.actor_id,'actor_name',x.actor_name,'reason',x.reason,'created_at',x.created_at,'gross_reserved_cents',gross::text,'applied_cents',applied::text,'residual_cents',residual::text,'dispositions',ds,'history',jsonb_build_array(jsonb_build_object('id',r.id,'ordinal',1,'previous_id',null,'request_id',x.request_id,'actor_id',x.actor_id,'actor_name',x.actor_name,'reason',x.reason,'created_at',x.created_at,'cost_before_cents',r.before_cents::text,'cost_after_cents',r.after_cents::text,'revision_after',rev)));
 return base||jsonb_build_object('verified',coalesce(ok,false),'issue',case when ok then null else 'finance_complement_extinction_chain_invalid' end,'effective_amount_cents',case when ok then applied::text end,'revision',rev,'regularization',reg,'complement_extinction',jsonb_build_object('id',x.id,'regularization_id',r.id,'request_id',x.request_id,'actor_id',x.actor_id,'reason',x.reason,'created_at',x.created_at,'cancelled_nominal_cents',finance_private.unloading_repair_cents(x.before_payable->'amount'),'residual_cents',residual::text));
end$$;

create or replace function finance_private.expense_cost_effective(t uuid,expense uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb;source jsonb;p public.payables%rowtype;x finance_private.expense_open_complement_amendments%rowtype;rev text;amount bigint;previous uuid;ordinal integer:=0;ok boolean;history jsonb:='[]';latest jsonb;
begin
 if exists(select 1 from finance_private.open_complement_extinctions closing where closing.tenant_id=t and closing.expense_id=expense) then return finance_private.expense_cost_before_open_complement(t,expense);end if;
 base:=finance_private.expense_cost_before_open_complement(t,expense);rev:=base->>'revision';amount:=(base->>'effective_amount_cents')::bigint;ok:=coalesce(base->>'verified'='true',false);
 if not exists(select 1 from finance_private.expense_open_complement_amendments a where a.tenant_id=t and a.expense_id=expense) then return base||jsonb_build_object('open_complement',null);end if;
 source:=finance_private.open_complement_source(t,expense);select * into p from public.payables where tenant_id=t and id=(base->>'payable_id')::uuid;
 for x in select * from finance_private.expense_open_complement_amendments a where a.tenant_id=t and a.expense_id=expense order by a.ordinal loop
  if x.ordinal<>ordinal+1 or x.previous_id is distinct from previous or x.revision_before is distinct from rev or x.base_revision is distinct from base->>'revision' or x.before_cost_cents is distinct from amount or x.source_snapshot is distinct from source or source->>'verified' is distinct from 'true' or x.allocated_cents::text is distinct from source->>'allocated_cents' or x.charge_id::text is distinct from base->>'charge_id' or x.payable_id::text is distinct from base->>'payable_id'
   or (x.before_payable-array['amount','status','updated_at']) is distinct from (x.after_payable-array['amount','status','updated_at']) or coalesce(x.before_payable->>'status','') not in('pending','approved') or x.after_payable->>'id' is distinct from x.payable_id::text or x.after_payable->>'tenant_id' is distinct from t::text or x.after_payable->>'source_id' is distinct from expense::text or x.after_payable->>'source_table' is distinct from 'finance_expense_items' or x.after_payable->>'status' is distinct from 'pending' or finance_private.unloading_repair_cents(x.before_payable->'amount') is distinct from (x.before_cost_cents-x.allocated_cents)::text or finance_private.unloading_repair_cents(x.after_payable->'amount') is distinct from (x.after_cost_cents-x.allocated_cents)::text
   or not exists(select 1 from public.finance_commands c where c.tenant_id=t and c.request_id=x.request_id and c.actor_id=x.actor_id and c.action='correct_open_unloading_complement' and c.result->>'amendment_id'=x.id::text and c.payload->>'expense_id'=expense::text and c.payload->>'amount_cents'=x.after_cost_cents::text and c.payload->>'charge_id'=x.charge_id::text and c.payload->>'payable_id'=x.payable_id::text and c.result->>'request_id'=x.request_id::text and c.result#>>'{effects,cost_before_cents}'=x.before_cost_cents::text and c.result#>>'{effects,cost_after_cents}'=x.after_cost_cents::text and c.result#>>'{effects,complement_after_cents}'=(x.after_cost_cents-x.allocated_cents)::text)
   or not exists(select 1 from public.finance_events a where a.tenant_id=t and a.entity_id=expense and a.actor_id=x.actor_id and a.action='unloading_open_complement_corrected' and a.after_data->>'amendment_id'=x.id::text and a.after_data#>>'{effects,cost_after_cents}'=x.after_cost_cents::text and a.before_data#>'{_evidence,source}'=x.source_snapshot)
  then ok:=false;end if;
  rev:=md5(jsonb_build_object('previous',rev,'event',to_jsonb(x))::text);amount:=x.after_cost_cents;previous:=x.id;ordinal:=x.ordinal;
  latest:=jsonb_build_object('id',x.id,'ordinal',x.ordinal,'previous_id',x.previous_id,'request_id',x.request_id,'actor_id',x.actor_id,'actor_name',x.actor_name,'reason',x.reason,'created_at',x.created_at,'cost_before_cents',x.before_cost_cents::text,'cost_after_cents',x.after_cost_cents::text,'complement_before_cents',(x.before_cost_cents-x.allocated_cents)::text,'complement_after_cents',(x.after_cost_cents-x.allocated_cents)::text,'allocated_reserved_cents',x.allocated_cents::text,'approval_reset',x.before_payable->>'status'='approved','revision_after',rev);history:=history||jsonb_build_array(latest);
 end loop;
 if p.id is null or finance_private.unloading_repair_cents(to_jsonb(p)->'amount') is distinct from (amount-(source->>'allocated_cents')::bigint)::text or p.source_table is distinct from 'finance_expense_items' or p.source_id is distinct from expense or (to_jsonb(p)-array['amount','status','updated_at','paid_amount','paid_at','bank_account_id','approved_at','approved_by']) is distinct from (x.after_payable-array['amount','status','updated_at','paid_amount','paid_at','bank_account_id','approved_at','approved_by']) then ok:=false;end if;
 return base||jsonb_build_object('verified',ok,'issue',case when ok then null else 'finance_open_complement_chain_invalid' end,'effective_amount_cents',case when ok then amount::text end,'revision',rev,'open_complement',latest||jsonb_build_object('history',history));
end$$;

create function finance_private.open_complement_extinction_context(t uuid,charge uuid,proposal jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ctx jsonb;funding jsonb;rows jsonb;ds jsonb:='[]';s jsonb;d jsonb;n bigint;total bigint:=0;valid boolean:=true;result jsonb;blockers jsonb;
begin
 if jsonb_typeof(proposal) is distinct from 'object' or coalesce(proposal->>'amount_cents','')!~'^[1-9][0-9]{0,13}$' or jsonb_typeof(proposal->'dispositions') is distinct from 'array' or jsonb_array_length(proposal->'dispositions')>500 or exists(select 1 from jsonb_object_keys(proposal) k where k not in('amount_cents','dispositions')) then raise exception 'finance_invalid_regularization_proposal' using errcode='22023';end if;
 ctx:=finance_private.unloading_open_complement_context(t,charge,proposal->>'amount_cents');
 select coalesce(jsonb_agg(b),'[]') into blockers from jsonb_array_elements(ctx->'blockers')b where b->>'code'<>'finance_open_complement_requires_disposition_plan';
 funding:=finance_private.expense_cost_funding(t,(ctx->>'expense_id')::uuid);rows:=funding->'rows';
 for d in select value from jsonb_array_elements(proposal->'dispositions') loop
 if coalesce(d->>'applied_cents','')!~'^(0|[1-9][0-9]{0,13})$' or exists(select 1 from jsonb_object_keys(d)k where k not in('source_kind','source_id','applied_cents','responsible_id','disposition_type')) then raise exception 'finance_invalid_regularization_proposal' using errcode='22023';end if;
 end loop;
 for s in select value from jsonb_array_elements(rows) loop
 select value into d from jsonb_array_elements(proposal->'dispositions')v where v->>'source_id'=s->>'source_id' and v->>'source_kind'=s->>'source_kind';
 if (select count(*) from jsonb_array_elements(proposal->'dispositions')v where v->>'source_id'=s->>'source_id' and v->>'source_kind'=s->>'source_kind')<>1 or s->>'source_kind'<>'expense_allocation' or d->>'responsible_id' is distinct from s->>'responsible_id' or d->>'disposition_type' is distinct from 'driver_custody' then valid:=false;n:=0;else n:=(d->>'applied_cents')::bigint;end if;
 if n>(s->>'gross_reserved_cents')::bigint then valid:=false;end if;total:=total+n;
 ds:=ds||jsonb_build_array((s-'_evidence')||jsonb_build_object('applied_cents',n::text,'residual_cents',((s->>'gross_reserved_cents')::bigint-n)::text));
 end loop;
 if funding->>'verified' is distinct from 'true' or not valid or jsonb_array_length(rows)<>jsonb_array_length(proposal->'dispositions') or total::text<>proposal->>'amount_cents' or total>(ctx->>'allocated_reserved_cents')::bigint then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_complement_extinction_disposition_mismatch','source_table','finance_expense_allocations','source_ids','[]'::jsonb));end if;
 begin perform finance_private.assert_closed_source_mutable(t,'payables',ctx#>'{_evidence,payable}'||jsonb_build_object('status','cancelled'));exception when sqlstate '55000' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_expense_closed_period_dependency','source_table','payables','source_ids',jsonb_build_array(ctx->'payable_id')));end;
 result:=(ctx-array['revision','target','effects','blockers','eligible'])||jsonb_build_object('proposal',proposal,'dispositions',ds,'target',jsonb_build_object('cost_cents',proposal->>'amount_cents','complement_cents','0','status','cancelled'),'blockers',blockers,'eligible',jsonb_array_length(blockers)=0,'effects',jsonb_build_object('cost_before_cents',ctx#>>'{cost_origin,effective_amount_cents}','cost_after_cents',proposal->>'amount_cents','complement_before_cents',ctx#>>'{payable,amount_cents}','complement_after_cents','0','historical_payable_nominal_cents',ctx#>>'{payable,amount_cents}','residual_cents',((ctx->>'allocated_reserved_cents')::bigint-total)::text,'capacity_released_cents','0','cash_changed',false,'approval_reset',ctx->'approval_reset'));
 return result||jsonb_build_object('revision',md5(result::text));
end$$;

create function finance_private.extinguish_open_unloading_complement(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;charge uuid;expense uuid;payable uuid;req uuid;actor uuid:=auth.uid();ctx jsonb;existing public.finance_commands%rowtype;p public.payables%rowtype;after_row jsonb;new_amendment uuid:=gen_random_uuid();new_reg uuid:=gen_random_uuid();d jsonb;result jsonb;actor_name text;
begin
 t:=(payload->>'tenant_id')::uuid;charge:=(payload->>'charge_id')::uuid;expense:=(payload->>'expense_id')::uuid;payable:=(payload->>'payable_id')::uuid;req:=(payload->>'request_id')::uuid;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if payload->'version' is distinct from '1'::jsonb or req is null or charge is null or expense is null or payable is null or coalesce(payload->>'revision','')!~'^[a-f0-9]{32}$' or jsonb_typeof(payload->'proposal') is distinct from 'object' or length(btrim(coalesce(payload->>'reason',''))) not between 10 and 2000 or exists(select 1 from jsonb_object_keys(payload) k where k<>all(array['version','tenant_id','request_id','charge_id','expense_id','payable_id','proposal','revision','reason'])) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into existing from public.finance_commands where tenant_id=t and request_id=req;if found then if existing.actor_id<>actor or existing.action<>'extinguish_open_unloading_complement' or existing.payload<>payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return existing.result;end if;
 perform 1 from public.finance_unloading_charges where tenant_id=t and id=charge for update nowait;
 perform public._lock_receivable_financial_graph(t,(select receivable_id from public.finance_unloading_charges where tenant_id=t and id=charge));
 perform 1 from public.payroll_periods where tenant_id=t order by id for update nowait;perform 1 from public.dispatch_trips where tenant_id=t and id in(select trip_id from public.finance_expense_batches where tenant_id=t and id=(select batch_id from public.finance_expense_items where tenant_id=t and id=expense)) for update nowait;
 perform 1 from public.driver_settlements where tenant_id=t order by id for update nowait;perform 1 from public.payroll_entries where tenant_id=t order by payroll_period_id,id for update nowait;
 perform 1 from public.finance_expense_items where tenant_id=t and id=expense for update nowait;select * into p from public.payables where tenant_id=t and id=payable for update nowait;
 perform 1 from public.payables where tenant_id=t and source_table='finance_expense_items' and source_id=expense order by id for update nowait;
 perform 1 from public.clients where tenant_id=t and id=p.supplier_id for share nowait;
 perform 1 from public.drivers where tenant_id=t and id=p.driver_id for share nowait;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform 1 from public.finance_expense_allocations where tenant_id=t and expense_id=expense order by id for update nowait;perform 1 from public.finance_movements where tenant_id=t and id in(select movement_id from public.finance_expense_allocations where tenant_id=t and expense_id=expense) order by id for update nowait;
 ctx:=finance_private.open_complement_extinction_context(t,charge,payload->'proposal');
 if ctx->>'expense_id' is distinct from expense::text or ctx->>'payable_id' is distinct from payable::text or ctx->>'revision' is distinct from payload->>'revision' then raise exception 'finance_unloading_cost_changed' using errcode='40001';end if;
 if ctx->>'eligible' is distinct from 'true' then raise exception 'finance_unloading_cost_blocked' using errcode='55000';end if;
 after_row:=to_jsonb(p)||jsonb_build_object('status','cancelled','updated_at',clock_timestamp());
 perform finance_private.assert_closed_source_mutable(t,'payables',to_jsonb(p));perform finance_private.assert_closed_source_mutable(t,'payables',after_row);
 insert into finance_private.expense_cost_tickets values(txid_current(),t,payable,actor,req,to_jsonb(p),after_row);
 update public.payables set status='cancelled',updated_at=(after_row->>'updated_at')::timestamptz where tenant_id=t and id=payable;
 if exists(select 1 from finance_private.expense_cost_tickets where transaction_id=txid_current() and tenant_id=t and payable_id=payable) then raise exception 'finance_unloading_cost_ticket_unconsumed' using errcode='55000';end if;
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where auth.users.id=actor;
 insert into finance_private.open_complement_extinctions(id,tenant_id,expense_id,charge_id,payable_id,regularization_id,request_id,actor_id,actor_name,reason,revision_before,cost_before,before_payable,after_payable,source_snapshot,proposal) values(new_amendment,t,expense,charge,payable,new_reg,req,actor,actor_name,btrim(payload->>'reason'),ctx->>'revision',ctx->'cost_origin',to_jsonb(p),after_row,ctx#>'{_evidence,source}',payload->'proposal');
 insert into finance_private.expense_cost_regularizations(id,tenant_id,expense_id,charge_id,payable_id,ordinal,request_id,actor_id,actor_name,reason,revision_before,base_revision,before_cents,after_cents,source_snapshot,proposal) values(new_reg,t,expense,charge,payable,1,req,actor,actor_name,btrim(payload->>'reason'),ctx#>>'{cost_origin,revision}',ctx#>>'{cost_origin,revision}',(ctx#>>'{cost_origin,effective_amount_cents}')::bigint,(payload#>>'{proposal,amount_cents}')::bigint,finance_private.expense_cost_funding(t,expense),payload->'proposal');
 for d in select value from jsonb_array_elements(ctx->'dispositions') loop
 insert into finance_private.expense_cost_dispositions(regularization_id,tenant_id,expense_id,source_kind,source_id,movement_id,payment_id,gross_reserved_cents,applied_cents,residual_cents,disposition_type,responsible_type,responsible_id,responsible_name) values(new_reg,t,expense,d->>'source_kind',(d->>'source_id')::uuid,(d->>'movement_id')::uuid,null,(d->>'gross_reserved_cents')::bigint,(d->>'applied_cents')::bigint,(d->>'residual_cents')::bigint,d->>'disposition_type',d->>'responsible_type',(d->>'responsible_id')::uuid,d->>'responsible_name');end loop;
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',actor,'request_id',req,'charge_id',charge,'expense_id',expense,'payable_id',payable,'extinction_id',new_amendment,'regularization_id',new_reg,'confirmed',true,'effects',ctx->'effects','payable_status','cancelled');
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'expense_item',expense,'unloading_open_complement_extinguished',actor,actor_name,btrim(payload->>'reason'),ctx,result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'extinguish_open_unloading_complement',payload,result);
 if finance_private.expense_cost_effective(t,expense)->>'verified' is distinct from 'true' then raise exception 'finance_expense_cost_chain_invalid' using errcode='23514';end if;return result;
exception when lock_not_available then raise exception 'finance_unloading_cost_busy' using errcode='40001';
end$$;
create or replace function finance_private.guard_open_complement_source() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb;t uuid;expense uuid;a finance_private.expense_open_complement_amendments%rowtype;v jsonb;
begin
 if tg_table_name='expense_cost_regularizations' and tg_op='INSERT' then if exists(select 1 from finance_private.open_complement_extinctions x where x.tenant_id=new.tenant_id and x.expense_id=new.expense_id and x.regularization_id=new.id and x.request_id=new.request_id and x.actor_id=auth.uid() and new.actor_id=auth.uid() and new.proposal=x.proposal and new.payable_id=x.payable_id and new.charge_id=x.charge_id and new.before_cents::text=x.cost_before->>'effective_amount_cents' and new.after_cents::text=x.proposal->>'amount_cents' and new.ordinal=1 and new.previous_id is null) and finance_private.can_repair_unloading(new.tenant_id) then return new;end if;end if;
 for row_data in select x from jsonb_array_elements(case when tg_op='INSERT' then jsonb_build_array(to_jsonb(new)) when tg_op='DELETE' then jsonb_build_array(to_jsonb(old)) else jsonb_build_array(to_jsonb(old),to_jsonb(new)) end)x loop
  t:=(row_data->>'tenant_id')::uuid;expense:=null;
  if tg_table_name='payables' then select e.id into expense from public.finance_expense_items e where e.tenant_id=t and e.payable_id=(row_data->>'id')::uuid;
  elsif tg_table_name='finance_movement_voids' then select a.expense_id into expense from public.finance_expense_allocations a join finance_private.expense_open_complement_amendments j on j.tenant_id=a.tenant_id and j.expense_id=a.expense_id where a.tenant_id=t and a.movement_id=(row_data->>'movement_id')::uuid limit 1;
  else expense:=(row_data->>'expense_id')::uuid;end if;
  select * into a from finance_private.expense_open_complement_amendments x where x.tenant_id=t and x.expense_id=expense order by x.ordinal desc limit 1;
  if a.id is null then continue;end if;
  if not pg_try_advisory_xact_lock(hashtextextended(t::text||':finance',0)) then raise exception 'finance_open_complement_busy' using errcode='40001';end if;
  if tg_table_name='payables' and tg_op='UPDATE' then
   if exists(select 1 from finance_private.expense_cost_tickets k where k.transaction_id=txid_current() and k.tenant_id=t and k.payable_id=old.id and k.actor_id=auth.uid() and k.before_data=to_jsonb(old) and k.after_data=to_jsonb(new)) then continue;end if;
   if (to_jsonb(old)-array['status','updated_at','paid_amount','paid_at','bank_account_id','approved_at','approved_by']) is distinct from (to_jsonb(new)-array['status','updated_at','paid_amount','paid_at','bank_account_id','approved_at','approved_by']) or new.status not in('pending','approved','paid','partial') then raise exception 'finance_open_complement_source_protected' using errcode='55000';end if;
   v:=finance_private.expense_cost_effective(t,expense);
   if v->>'verified' is distinct from 'true' then raise exception 'finance_open_complement_chain_invalid' using errcode='55000';end if;
  else raise exception 'finance_open_complement_source_protected' using errcode='55000';end if;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
end$$;

create function finance_private.consume_complement_extinction_ticket() returns trigger language plpgsql security definer set search_path='' as $$
declare ticket finance_private.expense_cost_tickets%rowtype;
begin
 if new.status='cancelled' and old.status is distinct from new.status and exists(select 1 from finance_private.expense_cost_tickets k where k.transaction_id=txid_current() and k.tenant_id=old.tenant_id and k.payable_id=old.id and k.actor_id=auth.uid()) then
 delete from finance_private.expense_cost_tickets k where k.transaction_id=txid_current() and k.tenant_id=old.tenant_id and k.payable_id=old.id and k.actor_id=auth.uid() and k.before_data=to_jsonb(old) and k.after_data=to_jsonb(new) returning * into ticket;
 if not found or not finance_private.can_repair_unloading(old.tenant_id) or (to_jsonb(old)-array['status','updated_at']) is distinct from (to_jsonb(new)-array['status','updated_at']) or old.status not in('pending','approved') or coalesce(old.paid_amount,0)<>0 then raise exception 'finance_complement_extinction_ticket_required' using errcode='55000';end if;
 end if;return new;
end$$;
create trigger zz_complement_extinction_ticket before update on public.payables for each row execute function finance_private.consume_complement_extinction_ticket();
create constraint trigger check_complement_extinction after insert on finance_private.open_complement_extinctions deferrable initially deferred for each row execute function finance_private.check_open_complement_chain();
-- Coverage keeps historical nominal separately; cancellation makes the obligation due zero.
do $coverage$declare body text;begin
 body:=pg_get_functiondef('finance_private.expense_cost_coverage(uuid,uuid)'::regprocedure);
 body:=replace(body,'return v||jsonb_build_object(', 'if exists(select 1 from finance_private.open_complement_extinctions closing where closing.tenant_id=t and closing.expense_id=expense) and v->>''verified''=''true'' then v:=v||jsonb_build_object(''complement_cents'',''0'');end if; return v||jsonb_build_object(');
 execute body;
end$coverage$;

revoke all on function finance_private.open_complement_before_extinction(uuid,uuid),finance_private.open_complement_extinction_context(uuid,uuid,jsonb),finance_private.extinguish_open_unloading_complement(jsonb),finance_private.consume_complement_extinction_ticket() from public,anon,authenticated,service_role;
