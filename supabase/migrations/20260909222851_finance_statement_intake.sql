-- Statement evidence is separate from declared movements and obligations.
-- Mapped rows remain unverified until source/account/coverage verification.
insert into storage.buckets(id,name,public,file_size_limit)
values('finance-statements','finance-statements',false,10485760) on conflict(id) do update set public=false,file_size_limit=10485760;
create policy finance_statement_read on storage.objects for select to authenticated
 using(bucket_id='finance-statements' and finance_private.can_read_receipt(name));
create policy finance_statement_read_boundary on storage.objects as restrictive for select to anon,authenticated
 using(bucket_id<>'finance-statements' or finance_private.can_read_receipt(name));
create policy finance_statement_no_browser_insert on storage.objects as restrictive for insert to anon,authenticated
 with check(bucket_id<>'finance-statements');
create policy finance_statement_no_browser_update on storage.objects as restrictive for update to anon,authenticated
 using(bucket_id<>'finance-statements') with check(bucket_id<>'finance-statements');
create policy finance_statement_no_browser_delete on storage.objects as restrictive for delete to anon,authenticated
 using(bucket_id<>'finance-statements');
create function finance_private.preserve_statement_file() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if old.bucket_id='finance-statements' then raise exception 'finance_statement_file_immutable' using errcode='23514';end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
revoke all on function finance_private.preserve_statement_file() from public,anon,authenticated,service_role;
create trigger preserve_finance_statement_file before update or delete on storage.objects
 for each row execute function finance_private.preserve_statement_file();

create table public.finance_statement_imports(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 bank_account_id uuid not null references public.bank_accounts(id),file_hash text not null check(file_hash~'^[a-f0-9]{64}$'),
 source_path text not null,file_name text not null,source_snapshot jsonb not null,parser_version text not null,mapping jsonb not null,
 period_start date not null,period_end date not null check(period_end>=period_start),
 currency text not null check(currency='BRL'),opening_cents bigint,closing_cents bigint,
 input_rows integer not null check(input_rows between 1 and 10000),created_by uuid not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),unique(tenant_id,file_hash)
);
create table public.finance_bank_entries(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,bank_account_id uuid not null references public.bank_accounts(id),
 first_import_id uuid not null,source_row integer not null,posted_on date not null,amount_cents bigint not null check(amount_cents<>0 and abs(amount_cents)<=99999999999999),
 currency text not null check(currency='BRL'),bank_id text,description text not null,document_number text,counterparty_document text,counterparty_name text,
 raw jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),unique(first_import_id,source_row),foreign key(tenant_id,first_import_id) references public.finance_statement_imports(tenant_id,id)
);
create unique index finance_bank_native_identity on public.finance_bank_entries(tenant_id,bank_account_id,bank_id) where bank_id is not null;
create index finance_bank_date_amount on public.finance_bank_entries(tenant_id,bank_account_id,posted_on,amount_cents);
create table public.finance_statement_rows(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,import_id uuid not null,source_row integer not null,
 raw jsonb not null,classification text not null check(classification in('new','duplicate','ambiguous','reference_conflict','repeated_reference')),
 bank_entry_id uuid,candidate_ids uuid[] not null default '{}',created_at timestamptz not null default clock_timestamp(),
 unique(import_id,source_row),foreign key(tenant_id,import_id) references public.finance_statement_imports(tenant_id,id),
 foreign key(tenant_id,bank_entry_id) references public.finance_bank_entries(tenant_id,id)
);
do $$declare t text;begin
 foreach t in array array['finance_statement_imports','finance_bank_entries','finance_statement_rows'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated,service_role',t);
  execute format('create policy finance_internal_read on public.%I for select to authenticated using(finance_private.can_access(tenant_id))',t);
  execute format('create trigger finance_immutable before update or delete on public.%I for each row execute function finance_private.preserve_event()',t);
 end loop;
end;$$;

create function finance_private.bank_entry_active(_tenant uuid,_entry uuid) returns boolean
language sql stable security definer set search_path='' as $$select exists(select 1 from public.finance_bank_entries where tenant_id=_tenant and id=_entry);$$;
revoke all on function finance_private.bank_entry_active(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.intake_statement(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;account uuid;request uuid;actor uuid:=auth.uid();source jsonb;v_import_id uuid;existing public.finance_commands%rowtype;
 row jsonb;position integer:=0;cents bigint;posted date;native_id text;classification text;entry_id uuid;candidates uuid[];
 prior public.finance_bank_entries%rowtype;result jsonb;hash text;path text;actor_name text;counts jsonb;native_counts jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;account:=(_payload->>'bank_account_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 hash:=_payload->>'file_hash';path:=_payload->>'source_path';
 if request is null or account is null or _payload->>'version' is distinct from '1'
   or coalesce(hash,'')!~'^[a-f0-9]{64}$' or coalesce(path,'')!~('^'||t::text||'/imports/'||hash||'\.(csv|xlsx|xls)$')
   or _payload->>'currency' is distinct from 'BRL' or coalesce(_payload->>'parser_version','') not in('mapped-csv-v1','mapped-workbook-v1')
   or jsonb_typeof(_payload->'mapping') is distinct from 'object' or jsonb_typeof(_payload->'rows') is distinct from 'array'
   or jsonb_array_length(_payload->'rows') not between 1 and 10000
   or coalesce(_payload->>'period_start','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(_payload->>'period_end','')!~'^\d{4}-\d{2}-\d{2}$'
   or (_payload->>'period_start')::date>(_payload->>'period_end')::date
   or length(btrim(coalesce(_payload->>'reason',''))) not between 5 and 2000
   or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','bank_account_id','file_hash','source_path',
    'currency','parser_version','mapping','rows','period_start','period_end','opening_cents','closing_cents','reason','file_name')) then
   raise exception 'finance_invalid_statement' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 select * into existing from public.finance_commands where tenant_id=t and request_id=request;
 if found then
   if existing.actor_id<>actor or existing.action<>'intake_statement' or existing.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
   return existing.result;
 end if;
 perform 1 from public.bank_accounts where id=account and tenant_id=t and active for share;
 if not found then raise exception 'finance_invalid_account' using errcode='22023';end if;
 if exists(select 1 from public.finance_statement_imports where tenant_id=t and file_hash=hash) then
   raise exception 'finance_statement_already_imported' using errcode='23505';end if;
 select to_jsonb(o) into source from storage.objects o where o.bucket_id='finance-statements' and o.name=path for share nowait;
 if source is null then raise exception 'finance_statement_source_missing' using errcode='22023';end if;
 insert into public.finance_statement_imports(tenant_id,bank_account_id,file_hash,source_path,file_name,source_snapshot,parser_version,mapping,
   period_start,period_end,currency,opening_cents,closing_cents,input_rows,created_by)
 values(t,account,hash,path,left(coalesce(nullif(_payload->>'file_name',''),split_part(path,'/',3)),255),source,_payload->>'parser_version',_payload->'mapping',(_payload->>'period_start')::date,(_payload->>'period_end')::date,
   'BRL',(_payload->>'opening_cents')::bigint,(_payload->>'closing_cents')::bigint,jsonb_array_length(_payload->'rows'),actor) returning id into v_import_id;
 select coalesce(jsonb_object_agg(k,n),'{}') into native_counts from(
   select nullif(btrim(r->>'bank_id'),'') k,count(*) n from jsonb_array_elements(_payload->'rows') r
   where nullif(btrim(r->>'bank_id'),'') is not null group by nullif(btrim(r->>'bank_id'),'')
 ) q;
 for row in select value from jsonb_array_elements(_payload->'rows') loop
   position:=position+1;entry_id:=null;candidates:='{}';native_id:=nullif(btrim(row->>'bank_id'),'');
   if jsonb_typeof(row) is distinct from 'object' or coalesce(row->>'amount_cents','')!~'^-?[0-9]{1,14}$'
     or coalesce(row->>'posted_on','')!~'^\d{4}-\d{2}-\d{2}$' or length(coalesce(row->>'description',''))>2000
     or length(coalesce(native_id,''))>200 or jsonb_typeof(row->'raw') is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(row) k where k not in('amount_cents','posted_on','bank_id','description','document_number','counterparty_document','counterparty_name','raw')) then
     raise exception 'finance_invalid_statement_row:%',position using errcode='22023';end if;
   cents:=(row->>'amount_cents')::bigint;posted:=(row->>'posted_on')::date;
   if cents=0 or posted<(_payload->>'period_start')::date or posted>(_payload->>'period_end')::date then
     raise exception 'finance_invalid_statement_row:%',position using errcode='22023';end if;
   classification:='new';
   if native_id is not null and (native_counts->>native_id)::integer>1 then
     classification:='repeated_reference';
   elsif native_id is not null then
     select * into prior from public.finance_bank_entries where tenant_id=t and bank_account_id=account and bank_id=native_id;
     if found then
       candidates:=array[prior.id];
       if prior.amount_cents=cents and prior.posted_on=posted and prior.currency='BRL'
         and (nullif(row->>'counterparty_document','') is null or prior.counterparty_document is null or prior.counterparty_document=row->>'counterparty_document') then
         classification:='duplicate';entry_id:=prior.id;
       else classification:='reference_conflict';end if;
     end if;
   end if;
   if classification='new' then
     select coalesce(array_agg(e.id order by e.id),'{}') into candidates from public.finance_bank_entries e
       where e.tenant_id=t and e.bank_account_id=account and e.posted_on=posted and e.amount_cents=cents and finance_private.bank_entry_active(t,e.id)
       and e.first_import_id<>v_import_id and (native_id is null or e.bank_id is null);
     if cardinality(candidates)>0 then classification:='ambiguous';end if;
   end if;
   if classification='new' then
     insert into public.finance_bank_entries(tenant_id,bank_account_id,first_import_id,source_row,posted_on,amount_cents,currency,
       bank_id,description,document_number,counterparty_document,counterparty_name,raw)
     values(t,account,v_import_id,position,posted,cents,'BRL',native_id,coalesce(row->>'description',''),nullif(row->>'document_number',''),
       nullif(row->>'counterparty_document',''),nullif(row->>'counterparty_name',''),row->'raw') returning id into entry_id;
   end if;
   insert into public.finance_statement_rows(tenant_id,import_id,source_row,raw,classification,bank_entry_id,candidate_ids)
     values(t,v_import_id,position,row,classification,entry_id,candidates);
 end loop;
 select jsonb_object_agg(q.classification,q.n) into counts from(select sr.classification,count(*) n from public.finance_statement_rows sr where sr.tenant_id=t and sr.import_id=v_import_id group by sr.classification) q;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'import_id',v_import_id,'counts',counts,
   'source_verification','pending','confirmed',true);
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 values(t,'statement_import',v_import_id,'mapped_rows_received',actor,coalesce(actor_name,actor::text),_payload->>'reason',result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'intake_statement',_payload,result);
 return result;
end;$$;
revoke all on function finance_private.intake_statement(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.intake_statement(jsonb) to authenticated;
create function public.intake_finance_statement(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.intake_statement(_payload);$$;
revoke all on function public.intake_finance_statement(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.intake_finance_statement(jsonb) to authenticated;
