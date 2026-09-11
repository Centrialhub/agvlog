alter table public.finance_reconciliation_groups drop constraint finance_reconciliation_groups_method_check;
alter table public.finance_reconciliation_groups add constraint finance_reconciliation_groups_method_check check(method in('manual','automatic_reference'));
create index finance_movement_bank_reference on public.finance_movements(tenant_id,bank_account_id,bank_reference) where bank_reference is not null;
create table public.finance_automatic_reconciliation_jobs(
 verification_id uuid primary key references public.finance_statement_verifications(id),tenant_id uuid not null references public.tenants(id),
 import_id uuid not null,actor_id uuid not null,status text not null default 'pending' check(status in('pending','complete','review','superseded')),
 cursor_id uuid,matched_count integer not null default 0,issue text,updated_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,import_id) references public.finance_statement_imports(tenant_id,id)
);
alter table public.finance_automatic_reconciliation_jobs enable row level security;
revoke all on public.finance_automatic_reconciliation_jobs from public,anon,authenticated,service_role;
grant select on public.finance_automatic_reconciliation_jobs to authenticated,service_role;
create policy finance_auto_jobs_read on public.finance_automatic_reconciliation_jobs for select to authenticated using(finance_private.can_access(tenant_id));
create index finance_auto_jobs_pending on public.finance_automatic_reconciliation_jobs(updated_at,verification_id) where status='pending';

-- The scheduler needs the same immutable snapshot, without impersonating an API
-- user. The existing exposed helper retains its authorization check and ACL.
do $$declare body text;original text;begin
 select pg_get_functiondef('finance_private.reconciliation_context(uuid,uuid[],uuid[])'::regprocedure) into body;
 -- pg_get_functiondef preserves the source body's original case.
 original:='if not finance_private.can_access(_tenant) then raise exception ''finance_access_denied'' using errcode=''42501'';end if;';
 if position(original in body)=0 then raise exception 'finance_auto_snapshot_contract_changed';end if;
 body:=replace(body,'finance_private.reconciliation_context(','finance_private.reconciliation_snapshot_internal(');
 execute replace(body,original,'');
end;$$;
revoke all on function finance_private.reconciliation_snapshot_internal(uuid,uuid[],uuid[]) from public,anon,authenticated,service_role;

create function finance_private.queue_automatic_reconciliation() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if new.outcome='rows_match' and exists(select 1 from public.finance_statement_imports i where i.tenant_id=new.tenant_id and i.id=new.import_id and i.parser_version='native-ofx-v1') then
  insert into public.finance_automatic_reconciliation_jobs(verification_id,tenant_id,import_id,actor_id) values(new.id,new.tenant_id,new.import_id,new.actor_id);
 end if;return new;
end;$$;
revoke all on function finance_private.queue_automatic_reconciliation() from public,anon,authenticated,service_role;
create trigger finance_queue_automatic_reconciliation after insert on public.finance_statement_verifications for each row execute function finance_private.queue_automatic_reconciliation();

-- A missing outgoing record can be entered after the statement was processed.
-- Revisit only imports containing this exact reference; the matcher still
-- excludes every prior manual decision and rechecks the full evidence.
create function finance_private.revisit_automatic_reconciliation() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if new.bank_reference is not null then
  update public.finance_automatic_reconciliation_jobs j set status='pending',cursor_id=null,updated_at=clock_timestamp()
  where j.tenant_id=new.tenant_id and j.status in('pending','complete')
   and exists(select 1 from public.finance_statement_rows sr join public.finance_bank_entries e on e.tenant_id=sr.tenant_id and e.id=sr.bank_entry_id
    where sr.tenant_id=j.tenant_id and sr.import_id=j.import_id and e.bank_account_id=new.bank_account_id and e.bank_id=new.bank_reference);
 end if;return new;
end;$$;
revoke all on function finance_private.revisit_automatic_reconciliation() from public,anon,authenticated,service_role;
create trigger finance_revisit_automatic_reconciliation after insert on public.finance_movements for each row execute function finance_private.revisit_automatic_reconciliation();

-- Quarantined rows do not create bank entries. They still contradict an
-- existing native identity and must prevent an automatic confirmation.
create index finance_statement_contested_reference on public.finance_statement_rows(tenant_id,(btrim(raw->>'bank_id')),import_id)
 where classification in('reference_conflict','repeated_reference','ambiguous');
create function finance_private.automatic_bank_reference_uncontested(_tenant uuid,_entry uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.finance_bank_entries e where e.tenant_id=_tenant and e.id=_entry and e.bank_id is not null
  and not exists(select 1 from public.finance_statement_rows r join public.finance_statement_imports i on i.tenant_id=r.tenant_id and i.id=r.import_id
   where r.tenant_id=_tenant and i.bank_account_id=e.bank_account_id and btrim(r.raw->>'bank_id')=e.bank_id
    and r.classification in('reference_conflict','repeated_reference','ambiguous')));
$$;
revoke all on function finance_private.automatic_bank_reference_uncontested(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.process_automatic_reconciliation(_verification uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare job public.finance_automatic_reconciliation_jobs%rowtype;assessment jsonb;e public.finance_bank_entries%rowtype;
 m public.finance_movements%rowtype;snapshot jsonb;actor_name text;group_id uuid;processed integer:=0;matched integer:=0;account uuid;
begin
 select * into job from public.finance_automatic_reconciliation_jobs where verification_id=_verification;
 if not found or job.status<>'pending' then return 0;end if;
 if not pg_try_advisory_xact_lock(hashtextextended(job.tenant_id::text||':finance',0)) then return 0;end if;
 select * into job from public.finance_automatic_reconciliation_jobs where verification_id=_verification and status='pending' for update skip locked;
 if not found then return 0;end if;
 if (select id from public.finance_statement_verifications where tenant_id=job.tenant_id and import_id=job.import_id order by created_at desc,id desc limit 1) is distinct from _verification then
  update public.finance_automatic_reconciliation_jobs set status='superseded',issue='newer_source_verification',updated_at=clock_timestamp() where verification_id=_verification;return 0;end if;
 if not exists(select 1 from public.tenant_memberships where tenant_id=job.tenant_id and user_id=job.actor_id and active and role::text in('owner','admin','operator'))
  or exists(select 1 from public.tenant_memberships where tenant_id=job.tenant_id and user_id=job.actor_id and active and role::text='driver')
  or exists(select 1 from public.drivers where tenant_id=job.tenant_id and user_id=job.actor_id and active) then
  update public.finance_automatic_reconciliation_jobs set status='review',issue='initiator_access_changed',updated_at=clock_timestamp() where verification_id=_verification;return 0;end if;
 select bank_account_id into account from public.finance_statement_imports where tenant_id=job.tenant_id and id=job.import_id;
 perform 1 from public.bank_accounts where tenant_id=job.tenant_id and id=account for share;
 assessment:=finance_private.native_statement_account(job.tenant_id,job.import_id);
 if assessment->>'status'<>'matched_exact' then
  update public.finance_automatic_reconciliation_jobs set status='review',issue='native_account_'||(assessment->>'status'),updated_at=clock_timestamp() where verification_id=_verification;return 0;end if;
 select coalesce(raw_user_meta_data->>'full_name',email,job.actor_id::text) into actor_name from auth.users where id=job.actor_id;
 for e in select be.* from public.finance_bank_entries be where be.tenant_id=job.tenant_id and be.bank_account_id=account
  and (job.cursor_id is null or be.id>job.cursor_id)
  and exists(select 1 from public.finance_statement_rows sr where sr.tenant_id=job.tenant_id and sr.import_id=job.import_id and sr.bank_entry_id=be.id)
  order by be.id limit 100
 loop
  processed:=processed+1;job.cursor_id:=e.id;
  if e.bank_id is null or not finance_private.bank_entry_active(job.tenant_id,e.id)
   or not finance_private.automatic_bank_reference_uncontested(job.tenant_id,e.id)
   or exists(select 1 from public.finance_statement_identity_reviews where tenant_id=job.tenant_id and bank_entry_id=e.id)
   or exists(select 1 from public.finance_reconciliation_groups g where g.tenant_id=job.tenant_id and g.bank_entry_ids@>array[e.id]) then continue;end if;
  if (finance_private.native_statement_account(job.tenant_id,e.first_import_id)->>'status')<>'matched_exact' then continue;end if;
  select * into m from public.finance_movements where tenant_id=job.tenant_id and bank_account_id=account and bank_reference=e.bank_id order by id limit 1;
  if not found then continue;end if;
  if exists(select 1 from public.finance_movements other where other.tenant_id=job.tenant_id and other.bank_account_id=account and other.bank_reference=e.bank_id and other.id<>m.id)
   or m.amount_cents<>abs(e.amount_cents) or m.occurred_on<>e.posted_on or (m.direction='in')<>(e.amount_cents>0)
   or exists(select 1 from public.finance_reconciliation_groups g where g.tenant_id=job.tenant_id and g.movement_ids@>array[m.id]) then continue;end if;
  snapshot:=finance_private.reconciliation_snapshot_internal(job.tenant_id,array[m.id],array[e.id])||jsonb_build_object('automatic_rule','native_reference_exact_v1','native_account_assessment',assessment);
  group_id:=gen_random_uuid();
  insert into public.finance_reconciliation_groups(id,tenant_id,bank_account_id,direction,amount_cents,movement_ids,bank_entry_ids,method,actor_id,actor_name,reason,account_evidence,evidence_snapshot)
  values(group_id,job.tenant_id,account,m.direction,m.amount_cents,array[m.id],array[e.id],'automatic_reference',job.actor_id,coalesce(actor_name,job.actor_id::text),
   'Referência única, data, valor e sentido idênticos na conta nativa conferida','Banco, agência, conta e tipo correspondem a um cadastro único',snapshot);
  insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
  values(job.tenant_id,'reconciliation_group',group_id,'bank_reconciled_automatically',job.actor_id,coalesce(actor_name,job.actor_id::text),
   'Conciliação automática por referência única, data, valor, sentido e conta nativa',jsonb_build_object('group_id',group_id,'method','automatic_reference','rule','native_reference_exact_v1','verification_id',_verification,'manual',false));
  matched:=matched+1;
 end loop;
 update public.finance_automatic_reconciliation_jobs set cursor_id=job.cursor_id,matched_count=matched_count+matched,
  status=case when processed<100 then 'complete' else 'pending' end,issue=null,updated_at=clock_timestamp() where verification_id=_verification;
 return matched;
end;$$;
revoke all on function finance_private.process_automatic_reconciliation(uuid) from public,anon,authenticated,service_role;

create function finance_private.run_automatic_reconciliation_queue() returns integer
language plpgsql security definer set search_path='' as $$declare job record;matched integer:=0;error_code text;begin
 if not pg_try_advisory_xact_lock(hashtextextended('finance:auto-reconciliation-worker',0)) then return 0;end if;
 for job in select verification_id,tenant_id,import_id,actor_id from public.finance_automatic_reconciliation_jobs where status='pending' order by updated_at,verification_id limit 10 loop
  begin matched:=matched+finance_private.process_automatic_reconciliation(job.verification_id);
  exception when others then
   get stacked diagnostics error_code=returned_sqlstate;
   update public.finance_automatic_reconciliation_jobs set status='review',issue='processing_error:'||error_code,updated_at=clock_timestamp() where verification_id=job.verification_id;
  end;
 end loop;return matched;
end;$$;
revoke all on function finance_private.run_automatic_reconciliation_queue() from public,anon,authenticated,service_role;

-- Later contradictory evidence must invalidate the displayed confirmation,
-- while retaining the original automatic decision and its provenance.
do $$declare body text;replacement text;begin
 select pg_get_functiondef('finance_private.reconciliation_evidence_issue(uuid,uuid)'::regprocedure) into body;
 if position(' return null;' in body)=0 then raise exception 'finance_auto_evidence_contract_changed';end if;
 replacement:=$patch$
 if g.method='automatic_reference' then
  if exists(select 1 from unnest(g.bank_entry_ids) entry_id where not finance_private.automatic_bank_reference_uncontested(_tenant,entry_id)) then return 'automatic_bank_reference_contested';end if;
  if exists(select 1 from public.finance_bank_entries e where e.tenant_id=_tenant and e.id=any(g.bank_entry_ids)
   and (finance_private.native_statement_account(_tenant,e.first_import_id)->>'status') is distinct from 'matched_exact') then return 'automatic_account_unconfirmed';end if;
  if cardinality(g.movement_ids)<>1 or cardinality(g.bank_entry_ids)<>1 then return 'automatic_reference_ambiguous';end if;
  if (select count(*) from public.finance_movements m join public.finance_bank_entries e
   on e.tenant_id=m.tenant_id and e.bank_account_id=m.bank_account_id and e.bank_id=m.bank_reference
   where e.tenant_id=_tenant and e.id=any(g.bank_entry_ids))<>1 then return 'automatic_reference_ambiguous';end if;
 end if;
 return null;
$patch$;
 execute replace(body,' return null;',replacement);
end;$$;
do $$begin
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
  execute $sql$select cron.schedule('finance-bank-reconciliation-every-minute','* * * * *','SET statement_timeout = ''25s''; SELECT finance_private.run_automatic_reconciliation_queue();')$sql$;
 else raise notice 'Automatic bank reconciliation requires pg_cron; use the dedicated bootstrap after enabling it.';end if;
end;$$;
