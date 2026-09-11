set local lock_timeout='3s';
set local statement_timeout='30s';
-- Private covered-cost regularization. No public writer promotion in this migration.
do $$declare p record;begin select * into p from pg_proc where oid='finance_private.expense_cost_effective(uuid,uuid)'::regprocedure;if md5(p.prosrc)<>'49f647f9eea5462e5293339318251b92' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(p.proacl)a where a.grantee<>p.proowner) then raise exception 'covered_cost_predecessor_changed' using errcode='55000';end if;end$$;
alter function finance_private.expense_cost_effective(uuid,uuid) rename to expense_cost_amended_base;
create table finance_private.expense_cost_regularizations(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,expense_id uuid not null,charge_id uuid not null,payable_id uuid,
 ordinal integer not null check(ordinal>0),previous_id uuid,request_id uuid not null,actor_id uuid not null,actor_name text,reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp(),
 revision_before text not null,base_revision text not null,before_cents bigint not null check(before_cents>0),after_cents bigint not null check(after_cents>0),source_snapshot jsonb not null,proposal jsonb not null,
 unique(tenant_id,expense_id,ordinal),unique(tenant_id,request_id),unique(tenant_id,expense_id,id),
 foreign key(tenant_id,expense_id) references public.finance_expense_items(tenant_id,id),foreign key(tenant_id,expense_id,previous_id) references finance_private.expense_cost_regularizations(tenant_id,expense_id,id),check((ordinal=1)=(previous_id is null)),check(before_cents<>after_cents)
);
create table finance_private.expense_cost_dispositions(
 id uuid primary key default gen_random_uuid(),regularization_id uuid not null references finance_private.expense_cost_regularizations(id),tenant_id uuid not null,expense_id uuid not null,
 source_kind text not null check(source_kind in('expense_allocation','payable_link')),source_id uuid not null,movement_id uuid not null,payment_id uuid,
 gross_reserved_cents bigint not null check(gross_reserved_cents>0),applied_cents bigint not null check(applied_cents>=0),residual_cents bigint not null check(residual_cents>=0),
 disposition_type text not null check(disposition_type in('driver_custody','payment_recovery')),responsible_type text not null check(responsible_type in('driver','supplier')),responsible_id uuid not null,responsible_name text,
 check(gross_reserved_cents=applied_cents+residual_cents),unique(regularization_id,source_kind,source_id),
 foreign key(tenant_id,expense_id,regularization_id) references finance_private.expense_cost_regularizations(tenant_id,expense_id,id),
 check((source_kind='expense_allocation' and payment_id is null and disposition_type='driver_custody' and responsible_type='driver') or (source_kind='payable_link' and payment_id is not null and disposition_type='payment_recovery' and responsible_type='supplier'))
);
do $$declare t text;begin foreach t in array array['expense_cost_regularizations','expense_cost_dispositions'] loop execute format('alter table finance_private.%I enable row level security',t);execute format('revoke all on finance_private.%I from public,anon,authenticated,service_role',t);execute format('create trigger preserve_regularization before update or delete on finance_private.%I for each row execute function finance_private.preserve_event()',t);end loop;end$$;
create function finance_private.expense_cost_funding(t uuid,expense uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.finance_expense_items%rowtype;b public.finance_expense_batches%rowtype;p public.payables%rowtype;s record;m public.finance_movements%rowtype;pay public.payables_payments%rowtype;rows jsonb:='[]';valid boolean:=true;item jsonb;rid uuid;rname text;raw jsonb;kind text;
begin
 perform finance_private.require_access(t);select * into e from public.finance_expense_items where tenant_id=t and id=expense;select * into b from public.finance_expense_batches where tenant_id=t and id=e.batch_id;select * into p from public.payables where tenant_id=t and id=e.payable_id;
 if e.id is null then raise exception 'finance_expense_not_found' using errcode='22023';end if;
 if (select count(*) from public.finance_commands c cross join lateral jsonb_array_elements(case when jsonb_typeof(c.payload->'items')='array' then c.payload->'items' else '[]'::jsonb end)i where c.tenant_id=t and c.action='record_expense_batch' and c.result->>'batch_id'=e.batch_id::text and i->>'id'=e.id::text and i->>'amount_cents'=e.amount_cents::text)<>1 then valid:=false;end if;
 for s in select 'expense_allocation'::text source_kind,a.id,a.movement_id,null::uuid payment_id,a.amount_cents,to_jsonb(a) evidence from public.finance_expense_allocations a where a.tenant_id=t and a.expense_id=e.id
 union all select 'payable_link',l.id,l.movement_id,l.payment_id,l.amount_cents,to_jsonb(l) from public.finance_payable_movement_links l where l.tenant_id=t and l.payable_id=e.payable_id order by source_kind,id loop
  select * into m from public.finance_movements where tenant_id=t and id=s.movement_id;
  if m.id is null or m.direction<>'out' or m.nature not in('driver_advance','payment') or not exists(select 1 from finance_private.active_movements a where a.tenant_id=t and a.id=m.id) or finance_private.movement_used_cents(t,m.id)>m.amount_cents or finance_private.movement_used_cents(t,m.id)<s.amount_cents then valid:=false;end if;
  pay:=null;rid:=null;rname:=null;
  if s.source_kind='expense_allocation' then
   rid:=b.driver_id;rname:=m.beneficiary_name;
   if rid is null or m.driver_id is distinct from rid or m.nature<>'driver_advance' then valid:=false;end if;
   if not exists(select 1 from public.finance_commands c cross join lateral jsonb_array_elements(c.payload->'items')i cross join lateral jsonb_array_elements(coalesce(i->'allocations','[]'))a where c.tenant_id=t and c.action='record_expense_batch' and c.result->>'batch_id'=e.batch_id::text and i->>'id'=e.id::text and a->>'movement_id'=m.id::text and a->>'amount_cents'=s.amount_cents::text) then valid:=false;end if;
  else
   select * into pay from public.payables_payments where tenant_id=t and id=s.payment_id;
   rid:=p.supplier_id;rname:=p.supplier_name;
   if p.id is null or p.source_table is distinct from 'finance_expense_items' or p.source_id is distinct from e.id or rid is null or p.supplier_id is distinct from e.supplier_id or p.supplier_name is distinct from e.supplier_name or nullif(btrim(m.beneficiary_name),'') is distinct from nullif(btrim(e.supplier_name),'') or pay.payable_id is distinct from p.id or pay.amount*100 is distinct from s.amount_cents::numeric or pay.bank_account_id is distinct from m.bank_account_id or exists(select 1 from public.finance_payable_link_reversals r where r.tenant_id=t and r.link_id=s.id) then valid:=false;end if;
   if not exists(select 1 from public.finance_commands c where c.tenant_id=t and c.action='apply_payable_movement' and c.result->>'link_id'=s.id::text and c.result->>'payment_id'=s.payment_id::text and c.result->>'payable_id'=p.id::text and c.result->>'movement_id'=m.id::text and c.result->>'amount_cents'=s.amount_cents::text and c.payload->>'payable_id'=p.id::text and c.payload->>'movement_id'=m.id::text and c.payload->>'amount_cents'=s.amount_cents::text) then valid:=false;end if;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('source_kind',s.source_kind,'source_id',s.id,'movement_id',s.movement_id,'payment_id',s.payment_id,'gross_reserved_cents',s.amount_cents::text,'responsible_id',rid,'responsible_name',rname,'responsible_type',case when s.source_kind='expense_allocation' then 'driver' else 'supplier' end,'disposition_type',case when s.source_kind='expense_allocation' then 'driver_custody' else 'payment_recovery' end,'_evidence',jsonb_build_object('source',s.evidence,'movement',to_jsonb(m),'payment',to_jsonb(pay))));
 end loop;
 if exists(select 1 from public.payables_payments pp where pp.tenant_id=t and pp.payable_id=e.payable_id and not exists(select 1 from public.finance_payable_movement_links l where l.tenant_id=t and l.payment_id=pp.id)) then valid:=false;end if;
 return jsonb_build_object('verified',valid,'rows',rows,'expense',to_jsonb(e),'batch',to_jsonb(b),'payable',to_jsonb(p));
end$$;
revoke all on function finance_private.expense_cost_funding(uuid,uuid) from public,anon,authenticated,service_role;
create function finance_private.expense_cost_effective(t uuid,expense uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb;funding jsonb;x finance_private.expense_cost_regularizations%rowtype;rev text;amount bigint;previous uuid;ordinal integer:=0;ok boolean;ds jsonb;history jsonb:='[]';latest jsonb:=null;gross bigint;applied bigint;residual bigint;
begin
 base:=finance_private.expense_cost_amended_base(t,expense);rev:=base->>'revision';amount:=(base->>'effective_amount_cents')::bigint;ok:=base->>'verified'='true';
 if not exists(select 1 from finance_private.expense_cost_regularizations r where r.tenant_id=t and r.expense_id=expense) then return base||jsonb_build_object('regularization',null);end if;
 funding:=finance_private.expense_cost_funding(t,expense);
 for x in select * from finance_private.expense_cost_regularizations r where r.tenant_id=t and r.expense_id=expense order by r.ordinal loop
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'source_kind',d.source_kind,'source_id',d.source_id,'movement_id',d.movement_id,'payment_id',d.payment_id,'gross_reserved_cents',d.gross_reserved_cents::text,'applied_cents',d.applied_cents::text,'residual_cents',d.residual_cents::text,'disposition_type',d.disposition_type,'responsible_type',d.responsible_type,'responsible_id',d.responsible_id,'responsible_name',d.responsible_name,'status','pending') order by d.source_kind,d.source_id),'[]'),coalesce(sum(d.gross_reserved_cents),0),coalesce(sum(d.applied_cents),0),coalesce(sum(d.residual_cents),0) into ds,gross,applied,residual from finance_private.expense_cost_dispositions d where d.tenant_id=t and d.regularization_id=x.id;
  if x.ordinal<>ordinal+1 or x.previous_id is distinct from previous or x.revision_before is distinct from rev or x.base_revision is distinct from base->>'revision' or x.before_cents is distinct from amount or x.charge_id::text is distinct from base->>'charge_id' or x.payable_id::text is distinct from base->>'payable_id' or funding->>'verified' is distinct from 'true' or x.source_snapshot is distinct from funding or applied<>x.after_cents or residual<=0 or jsonb_array_length(ds)<>jsonb_array_length(funding->'rows')
   or exists(select 1 from jsonb_array_elements(ds)d where not exists(select 1 from jsonb_array_elements(funding->'rows')s where s->>'source_kind'=d->>'source_kind' and s->>'source_id'=d->>'source_id' and s->>'movement_id'=d->>'movement_id' and s->>'gross_reserved_cents'=d->>'gross_reserved_cents' and s->>'responsible_id'=d->>'responsible_id' and s->>'disposition_type'=d->>'disposition_type' and s->>'responsible_type'=d->>'responsible_type' and s->>'payment_id' is not distinct from d->>'payment_id'))
   or exists(select 1 from jsonb_array_elements(ds)d where not exists(select 1 from jsonb_array_elements(x.proposal->'dispositions')p where p->>'source_kind'=d->>'source_kind' and p->>'source_id'=d->>'source_id' and p->>'applied_cents'=d->>'applied_cents' and p->>'responsible_id'=d->>'responsible_id' and p->>'disposition_type'=d->>'disposition_type'))
   or not exists(select 1 from public.finance_commands c where c.tenant_id=t and c.request_id=x.request_id and c.actor_id=x.actor_id and c.action='regularize_unloading_cost' and c.payload->'proposal'=x.proposal and c.payload->>'expense_id'=expense::text and c.result->>'regularization_id'=x.id::text)
   or not exists(select 1 from public.finance_events a where a.tenant_id=t and a.entity_id=expense and a.action='unloading_cost_regularized' and a.actor_id=x.actor_id and a.after_data->>'regularization_id'=x.id::text)
  then ok:=false;end if;
  rev:=md5(jsonb_build_object('previous',rev,'event',to_jsonb(x),'dispositions',ds)::text);amount:=x.after_cents;ordinal:=x.ordinal;previous:=x.id;
  latest:=jsonb_build_object('id',x.id,'ordinal',x.ordinal,'previous_id',x.previous_id,'request_id',x.request_id,'actor_id',x.actor_id,'actor_name',x.actor_name,'reason',x.reason,'created_at',x.created_at,'gross_reserved_cents',gross::text,'applied_cents',applied::text,'residual_cents',residual::text,'dispositions',ds);
  history:=history||jsonb_build_array((latest-array['dispositions','gross_reserved_cents','applied_cents','residual_cents'])||jsonb_build_object('cost_before_cents',x.before_cents::text,'cost_after_cents',x.after_cents::text,'revision_after',rev));
 end loop;
 return base||jsonb_build_object('verified',ok,'issue',case when ok then null else 'finance_cost_regularization_chain_invalid' end,'effective_amount_cents',case when ok then amount::text end,'revision',rev,'regularization',latest||jsonb_build_object('history',history));
end$$;
revoke all on function finance_private.expense_cost_effective(uuid,uuid) from public,anon,authenticated,service_role;
create function finance_private.unloading_cost_regularization_context(t uuid,charge uuid,proposal jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.finance_expense_items%rowtype;p public.payables%rowtype;cost jsonb;funding jsonb;origin jsonb;s jsonb;d jsonb;rows jsonb:='[]';ds jsonb:='[]';blockers jsonb:='[]';materials jsonb;dependencies jsonb;result jsonb;target bigint;gross bigint:=0;applied bigint:=0;driver_cents bigint:=0;recovery_cents bigint:=0;n bigint;valid boolean:=true;nominal text;paid text;
begin
 perform finance_private.require_access(t);
 if jsonb_typeof(proposal) is distinct from 'object' or coalesce(proposal->>'amount_cents','')!~'^[1-9][0-9]{0,13}$' or jsonb_typeof(proposal->'dispositions') is distinct from 'array' or jsonb_array_length(proposal->'dispositions')>500 or exists(select 1 from jsonb_object_keys(proposal)k where k not in('amount_cents','dispositions')) then raise exception 'finance_invalid_regularization_proposal' using errcode='22023';end if;
 target:=(proposal->>'amount_cents')::bigint;
 select * into e from public.finance_expense_items where tenant_id=t and unloading_id=charge;
 if e.id is null then raise exception 'finance_unloading_cost_source_unavailable' using errcode='22023';end if;
 select * into p from public.payables where tenant_id=t and id=e.payable_id;
 cost:=finance_private.expense_cost_effective(t,e.id);funding:=finance_private.expense_cost_funding(t,e.id);origin:=finance_private.unloading_effective_origin(t,charge);
 if cost->>'verified' is distinct from 'true' or funding->>'verified' is distinct from 'true' or origin->>'verified' is distinct from 'true' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_cost_funding_unverified','source_table','finance_expense_items','source_ids',jsonb_build_array(e.id)));end if;
 for d in select value from jsonb_array_elements(proposal->'dispositions') loop
  if jsonb_typeof(d) is distinct from 'object' or coalesce(d->>'applied_cents','')!~'^(0|[1-9][0-9]{0,13})$' or coalesce(d->>'source_kind','') not in('expense_allocation','payable_link') or coalesce(d->>'source_id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or coalesce(d->>'responsible_id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or coalesce(d->>'disposition_type','') not in('driver_custody','payment_recovery') or exists(select 1 from jsonb_object_keys(d)k where k<>all(array['source_kind','source_id','applied_cents','disposition_type','responsible_id'])) then raise exception 'finance_invalid_regularization_proposal' using errcode='22023';end if;
 end loop;
 for s in select value from jsonb_array_elements(funding->'rows') loop
  rows:=rows||jsonb_build_array(s-'_evidence');
  select value into d from jsonb_array_elements(proposal->'dispositions') where value->>'source_kind'=s->>'source_kind' and value->>'source_id'=s->>'source_id';
  if (select count(*) from jsonb_array_elements(proposal->'dispositions')v where v->>'source_kind'=s->>'source_kind' and v->>'source_id'=s->>'source_id')<>1 or d->>'responsible_id' is distinct from s->>'responsible_id' or d->>'disposition_type' is distinct from s->>'disposition_type' then valid:=false;n:=0;else n:=(d->>'applied_cents')::bigint;end if;
  if n>(s->>'gross_reserved_cents')::bigint then valid:=false;end if;
  gross:=gross+(s->>'gross_reserved_cents')::bigint;applied:=applied+n;
  ds:=ds||jsonb_build_array((s-'_evidence')||jsonb_build_object('applied_cents',n::text,'residual_cents',((s->>'gross_reserved_cents')::bigint-n)::text,'status','pending'));
  if s->>'disposition_type'='driver_custody' then driver_cents:=driver_cents+(s->>'gross_reserved_cents')::bigint-n;else recovery_cents:=recovery_cents+(s->>'gross_reserved_cents')::bigint-n;end if;
 end loop;
 if not valid or jsonb_array_length(proposal->'dispositions')<>jsonb_array_length(rows) or applied<>target or target>=gross or gross=0 or gross is distinct from (finance_private.expense_cost_amended_base(t,e.id)->>'effective_amount_cents')::bigint then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_cost_disposition_mismatch','source_table','finance_expense_items','source_ids',jsonb_build_array(e.id)));end if;
 if cost->>'effective_amount_cents'=target::text then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_unloading_cost_unchanged','source_table','finance_expense_items','source_ids',jsonb_build_array(e.id)));end if;
 nominal:=finance_private.unloading_repair_cents(to_jsonb(p)->'amount');paid:=finance_private.unloading_repair_cents(to_jsonb(p)->'paid_amount');
 if p.id is not null and (p.status<>'paid' or nominal is null or paid is distinct from nominal or (select coalesce(sum((v->>'gross_reserved_cents')::bigint),0) from jsonb_array_elements(rows)v where v->>'source_kind'='payable_link')<>nominal::bigint) then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_cost_open_obligation_requires_plan','source_table','payables','source_ids',jsonb_build_array(p.id)));end if;
 dependencies:=finance_private.unloading_cost_cancellation_context(t,e.id)->'snapshot';
 if exists(select 1 from unnest(array['legacy_links','maintenance_claims','labor_history','part_history','stock_history','advances'])k where jsonb_array_length(coalesce(dependencies->k,'[]'))>0) then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_cost_other_source_requires_plan','source_table','finance_expense_items','source_ids',jsonb_build_array(e.id)));end if;
 if exists(select 1 from public.finance_expense_cancellations c where c.tenant_id=t and c.expense_id=e.id) then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_expense_already_cancelled','source_table','finance_expense_items','source_ids',jsonb_build_array(e.id)));end if;
 select coalesce(jsonb_agg(v order by v->>'source_table',v->>'id'),'[]') into materials from (select to_jsonb(x)||jsonb_build_object('materialization_table','driver_settlement_items') v from public.driver_settlement_items x where x.tenant_id=t and ((x.source_table='finance_expense_items' and x.source_id=e.id) or(x.source_table='payables' and x.source_id=p.id)) union all select to_jsonb(x)||jsonb_build_object('materialization_table','payroll_entry_items') from public.payroll_entry_items x where x.tenant_id=t and ((x.source_table='finance_expense_items' and x.source_id=e.id)or(x.source_table='payables' and x.source_id=p.id))) materialization_rows;
 if jsonb_array_length(materials)>0 or exists(select 1 from public.payroll_entry_items x where x.tenant_id=t and ((x.source_table='finance_expense_items' and x.source_id=e.id)or(x.source_table='payables' and x.source_id=p.id))) then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_cost_materialization_requires_review','source_table','finance_expense_items','source_ids',jsonb_build_array(e.id)));end if;
 begin for s in select value from jsonb_array_elements(funding->'rows') loop perform finance_private.assert_closed_source_mutable(t,'finance_movements',s#>'{_evidence,movement}');end loop;perform finance_private.assert_closed_source_mutable(t,'finance_expense_items',to_jsonb(e));if p.id is not null then perform finance_private.assert_closed_source_mutable(t,'payables',to_jsonb(p));end if;exception when sqlstate '55000' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_expense_closed_period_dependency','source_table','finance_expense_items','source_ids',jsonb_build_array(e.id)));end;
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',auth.uid(),'charge_id',charge,'expense_id',e.id,'payable_id',e.payable_id,'cost_origin',cost,'source_rows',rows,'dispositions',ds,'obligation',jsonb_build_object('action','preserve_historical','nominal_cents',nominal,'paid_cents',paid,'open_cents',case when nominal is not null and paid is not null then (nominal::bigint-paid::bigint)::text end),'materialization_plan',jsonb_build_object('action',case when jsonb_array_length(materials)>0 then 'review_required' else 'none' end,'source_ids',(select coalesce(jsonb_agg(v->'id'),'[]') from jsonb_array_elements(materials)v)),'blockers',blockers,'eligible',jsonb_array_length(blockers)=0,'can_regularize',finance_private.can_repair_unloading(t),'can_execute',false,
 'effects',jsonb_build_object('computation','prospective_cost_regularization','cost_before_cents',cost->>'effective_amount_cents','cost_after_cents',target::text,'cost_delta_cents',case when cost->>'effective_amount_cents' is not null then (target-(cost->>'effective_amount_cents')::bigint)::text end,'gross_reserved_cents',gross::text,'applied_cents',applied::text,'residual_cents',(gross-applied)::text,'driver_custody_cents',driver_cents::text,'payment_recovery_cents',recovery_cents::text,'cash_changed',false,'payable_changed',false,'reconciliation_changed',false,'movement_capacity_released_cents','0'),
 '_evidence',jsonb_build_object('funding',funding,'origin',origin,'materializations',materials,'dependencies',dependencies));
 return result||jsonb_build_object('revision',md5(result::text));
end$$;
revoke all on function finance_private.unloading_cost_regularization_context(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function finance_private.regularize_unloading_cost(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;charge uuid;expense uuid;payable uuid;req uuid;actor uuid:=auth.uid();ctx jsonb;existing public.finance_commands%rowtype;prior finance_private.expense_cost_regularizations%rowtype;new_id uuid;did uuid;ids jsonb:='[]';d jsonb;result jsonb;actor_name text;
begin
 t:=(payload->>'tenant_id')::uuid;charge:=(payload->>'charge_id')::uuid;expense:=(payload->>'expense_id')::uuid;payable:=(payload->>'payable_id')::uuid;req:=(payload->>'request_id')::uuid;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if payload->'version' is distinct from '1'::jsonb or req is null or charge is null or expense is null or not payload?'payable_id' or coalesce(payload->>'revision','')!~'^[a-f0-9]{32}$' or length(btrim(coalesce(payload->>'reason',''))) not between 10 and 2000 or exists(select 1 from jsonb_object_keys(payload)k where k<>all(array['version','tenant_id','request_id','charge_id','expense_id','payable_id','revision','proposal','reason'])) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into existing from public.finance_commands where tenant_id=t and request_id=req;if found then if existing.actor_id<>actor or existing.action<>'regularize_unloading_cost' or existing.payload<>payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return existing.result;end if;
 perform 1 from public.finance_unloading_charges where tenant_id=t and id=charge for update nowait;
 perform public._lock_receivable_financial_graph(t,(select receivable_id from public.finance_unloading_charges where tenant_id=t and id=charge));
 perform 1 from public.payroll_periods where tenant_id=t order by id for update nowait;perform 1 from public.driver_settlements where tenant_id=t order by id for update nowait;perform 1 from public.payroll_entries where tenant_id=t order by payroll_period_id,id for update nowait;
 perform 1 from public.finance_expense_items where tenant_id=t and id=expense for update nowait;perform 1 from public.payables where tenant_id=t and id=payable for update nowait;
 perform 1 from public.finance_expense_allocations where tenant_id=t and expense_id=expense order by id for update nowait;perform 1 from public.finance_payable_movement_links where tenant_id=t and payable_id=payable order by id for update nowait;perform 1 from public.payables_payments where tenant_id=t and payable_id=payable order by id for update nowait;
 perform 1 from public.finance_movements where tenant_id=t and id in(select movement_id from public.finance_expense_allocations where tenant_id=t and expense_id=expense union select movement_id from public.finance_payable_movement_links where tenant_id=t and payable_id=payable) order by id for update nowait;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 ctx:=finance_private.unloading_cost_regularization_context(t,charge,payload->'proposal');
 if ctx->>'expense_id' is distinct from expense::text or ctx->>'payable_id' is distinct from payable::text or ctx->>'revision' is distinct from payload->>'revision' then raise exception 'finance_cost_regularization_changed' using errcode='40001';end if;
 if ctx->>'eligible' is distinct from 'true' then raise exception 'finance_cost_regularization_blocked' using errcode='55000';end if;
 select * into prior from finance_private.expense_cost_regularizations r where r.tenant_id=t and r.expense_id=expense order by r.ordinal desc limit 1;
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where auth.users.id=actor;
 insert into finance_private.expense_cost_regularizations(tenant_id,expense_id,charge_id,payable_id,ordinal,previous_id,request_id,actor_id,actor_name,reason,revision_before,base_revision,before_cents,after_cents,source_snapshot,proposal)
 values(t,expense,charge,payable,coalesce(prior.ordinal,0)+1,prior.id,req,actor,actor_name,btrim(payload->>'reason'),ctx#>>'{cost_origin,revision}',finance_private.expense_cost_amended_base(t,expense)->>'revision',(ctx#>>'{effects,cost_before_cents}')::bigint,(ctx#>>'{effects,cost_after_cents}')::bigint,ctx#>'{_evidence,funding}',payload->'proposal') returning id into new_id;
 for d in select value from jsonb_array_elements(ctx->'dispositions') loop
  insert into finance_private.expense_cost_dispositions(regularization_id,tenant_id,expense_id,source_kind,source_id,movement_id,payment_id,gross_reserved_cents,applied_cents,residual_cents,disposition_type,responsible_type,responsible_id,responsible_name)
  values(new_id,t,expense,d->>'source_kind',(d->>'source_id')::uuid,(d->>'movement_id')::uuid,(d->>'payment_id')::uuid,(d->>'gross_reserved_cents')::bigint,(d->>'applied_cents')::bigint,(d->>'residual_cents')::bigint,d->>'disposition_type',d->>'responsible_type',(d->>'responsible_id')::uuid,d->>'responsible_name') returning id into did;ids:=ids||jsonb_build_array(did);
 end loop;
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',actor,'request_id',req,'charge_id',charge,'expense_id',expense,'payable_id',payable,'regularization_id',new_id,'disposition_ids',ids,'confirmed',true,'effects',ctx->'effects');
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'expense_item',expense,'unloading_cost_regularized',actor,actor_name,btrim(payload->>'reason'),ctx-'_evidence',result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'regularize_unloading_cost',payload,result);
 if finance_private.expense_cost_effective(t,expense)->>'verified' is distinct from 'true' then raise exception 'finance_cost_regularization_chain_invalid' using errcode='23514';end if;return result;
exception when lock_not_available then raise exception 'finance_cost_regularization_busy' using errcode='40001';end$$;
revoke all on function finance_private.regularize_unloading_cost(jsonb) from public,anon,authenticated,service_role;
create function finance_private.check_cost_regularization_chain() returns trigger language plpgsql security definer set search_path='' as $$begin if finance_private.expense_cost_effective(new.tenant_id,new.expense_id)->>'verified' is distinct from 'true' then raise exception 'finance_cost_regularization_chain_invalid' using errcode='23514';end if;return null;end$$;
revoke all on function finance_private.check_cost_regularization_chain() from public,anon,authenticated,service_role;
create constraint trigger cost_regularization_chain after insert on finance_private.expense_cost_regularizations deferrable initially deferred for each row execute function finance_private.check_cost_regularization_chain();
create constraint trigger cost_disposition_chain after insert on finance_private.expense_cost_dispositions deferrable initially deferred for each row execute function finance_private.check_cost_regularization_chain();
-- Raw reservations cannot be released while a disposition is unresolved. These
-- additive guards do not modify capacity readers or captured legacy functions.
create function finance_private.guard_cost_regularization_source() returns trigger language plpgsql security definer set search_path='' as $$
declare rowdata jsonb;rowversions jsonb;t uuid;e uuid;movement uuid;link uuid;p uuid;
begin
 if tg_table_name='payables' and tg_op='UPDATE' and to_jsonb(old)=to_jsonb(new) then return new;end if;
 rowversions:=case when tg_op='UPDATE' then jsonb_build_array(to_jsonb(old),to_jsonb(new)) when tg_op='DELETE' then jsonb_build_array(to_jsonb(old)) else jsonb_build_array(to_jsonb(new)) end;
 for rowdata in select value from jsonb_array_elements(rowversions) loop
 t:=(rowdata->>'tenant_id')::uuid;e:=null;movement:=null;link:=null;p:=null;
 if not pg_try_advisory_xact_lock(hashtextextended(t::text||':finance',0)) then raise exception 'finance_dependency_busy' using errcode='40001';end if;
 if tg_table_name in('expense_cost_amendments','finance_expense_allocations','finance_expense_cancellations') then e:=(rowdata->>'expense_id')::uuid;
 elsif tg_table_name in('payables','payables_payments','finance_payable_movement_links') then
  p:=case when tg_table_name='payables' then (rowdata->>'id')::uuid else (rowdata->>'payable_id')::uuid end;select id into e from public.finance_expense_items where tenant_id=t and payable_id=p;
 elsif tg_table_name='finance_payable_link_reversals' then link:=(rowdata->>'link_id')::uuid;select x.id into e from public.finance_payable_movement_links l join public.finance_expense_items x on x.tenant_id=l.tenant_id and x.payable_id=l.payable_id where l.tenant_id=t and l.id=link;
 elsif tg_table_name='finance_movement_voids' then movement:=(rowdata->>'movement_id')::uuid;
 end if;
 if exists(select 1 from finance_private.expense_cost_regularizations r where r.tenant_id=t and r.expense_id=e) or exists(select 1 from finance_private.expense_cost_dispositions d where d.tenant_id=t and d.movement_id=movement) then
  raise exception 'finance_cost_disposition_requires_resolution' using errcode='55000';
 end if;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
revoke all on function finance_private.guard_cost_regularization_source() from public,anon,authenticated,service_role;
create trigger a_cost_regularization_guard before insert on finance_private.expense_cost_amendments for each row execute function finance_private.guard_cost_regularization_source();
create trigger a_cost_regularization_guard before insert or update or delete on public.finance_expense_allocations for each row execute function finance_private.guard_cost_regularization_source();
create trigger a_cost_regularization_guard before insert on public.finance_expense_cancellations for each row execute function finance_private.guard_cost_regularization_source();
create trigger a_cost_regularization_guard before update or delete on public.payables for each row execute function finance_private.guard_cost_regularization_source();
create trigger a_cost_regularization_guard before insert or update or delete on public.payables_payments for each row execute function finance_private.guard_cost_regularization_source();
create trigger a_cost_regularization_guard before insert on public.finance_payable_movement_links for each row execute function finance_private.guard_cost_regularization_source();
create trigger a_cost_regularization_guard before insert on public.finance_payable_link_reversals for each row execute function finance_private.guard_cost_regularization_source();
create trigger a_cost_regularization_guard before insert on public.finance_movement_voids for each row execute function finance_private.guard_cost_regularization_source();
