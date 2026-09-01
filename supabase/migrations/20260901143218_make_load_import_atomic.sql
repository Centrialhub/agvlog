-- Atomic bookkeeping-only import. It never emits fiscal documents, advances an
-- existing load state, or changes payment evidence.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regclass('public.loads') is null
     or to_regclass('public.load_import_batches') is null
     or to_regclass('public.load_documents') is null
     or to_regclass('public.load_items') is null
     or to_regclass('public.load_unloading_charges') is null
     or to_regclass('public.fiscal_documents') is null
     or to_regclass('private.load_import_commands') is not null then
    raise exception 'Load imports require the canonical schema and an unapplied migration';
  end if;
end;
$guard$;

create schema if not exists private;
create unique index if not exists load_import_batches_tenant_id_id_uidx on public.load_import_batches(tenant_id,id);
create unique index if not exists load_documents_tenant_id_id_uidx on public.load_documents(tenant_id,id);
create unique index if not exists load_items_tenant_id_id_uidx on public.load_items(tenant_id,id);
create unique index if not exists load_unloading_charges_tenant_id_id_uidx on public.load_unloading_charges(tenant_id,id);

alter table public.load_documents
 add constraint load_documents_load_tenant_fkey foreign key(tenant_id,load_id) references public.loads(tenant_id,id) on delete cascade not valid,
 add constraint load_documents_fiscal_tenant_fkey foreign key(tenant_id,fiscal_document_id) references public.fiscal_documents(tenant_id,id) on delete restrict not valid;
alter table public.load_items
 add constraint load_items_load_tenant_fkey foreign key(tenant_id,load_id) references public.loads(tenant_id,id) on delete cascade not valid,
 add constraint load_items_fiscal_tenant_fkey foreign key(tenant_id,fiscal_document_id) references public.fiscal_documents(tenant_id,id) on delete restrict not valid;
alter table public.load_unloading_charges
 add constraint load_unloading_load_tenant_fkey foreign key(tenant_id,load_id) references public.loads(tenant_id,id) on delete restrict not valid,
 add constraint load_unloading_fiscal_tenant_fkey foreign key(tenant_id,fiscal_document_id) references public.fiscal_documents(tenant_id,id) on delete restrict not valid,
 add constraint load_unloading_batch_tenant_fkey foreign key(tenant_id,import_batch_id) references public.load_import_batches(tenant_id,id) on delete set null not valid;

create table private.load_import_commands(
 id uuid primary key, tenant_id uuid not null, actor_id uuid not null, request_id uuid not null,
 payload_hash text not null check(payload_hash~'^[a-f0-9]{64}$'), batch_id uuid not null,
 response jsonb not null, created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id), unique(tenant_id,actor_id,request_id),
 foreign key(tenant_id,batch_id) references public.load_import_batches(tenant_id,id) on delete restrict
);
create index load_import_commands_batch_idx on private.load_import_commands(tenant_id,batch_id);
alter table private.load_import_commands enable row level security;
revoke all on table private.load_import_commands from public,anon,authenticated,service_role;

create function private.preserve_load_import_command() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'load_import_command_is_immutable' using errcode='55000'; end;$$;
revoke all on function private.preserve_load_import_command() from public,anon,authenticated,service_role;
create trigger load_import_commands_append_only before update or delete on private.load_import_commands
for each row execute function private.preserve_load_import_command();

create function public.apply_load_import_command(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
 v_actor uuid:=auth.uid(); v_tenant uuid; v_request uuid; v_command uuid:=gen_random_uuid(); v_batch uuid:=gen_random_uuid();
 v_hash text; v_source text; v_file text; v_file_count integer; v_previous private.load_import_commands%rowtype;
 l jsonb; d jsonb; u jsonb; v_load uuid; v_fiscal uuid; v_existing public.loads%rowtype; v_financial boolean;
 n_load integer:=0; u_load integer:=0; n_doc integer:=0; d_doc integer:=0;
 n_item integer:=0; d_item integer:=0; n_unload integer:=0; d_unload integer:=0; n_rate integer:=0;
 v_response jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or octet_length(_payload::text)>2000000
    or _payload->'version' is distinct from '1'::jsonb
    or exists(select 1 from jsonb_object_keys(_payload) k where k not in
      ('version','tenant_id','actor_id','request_id','source_type','file_name','file_count','loads','documents','unloading_charges')) then
   raise exception 'load_import_invalid_command' using errcode='22023';
 end if;
 begin
   v_tenant:=(_payload->>'tenant_id')::uuid; v_request:=(_payload->>'request_id')::uuid;
   v_file_count:=(_payload->>'file_count')::integer;
 exception when invalid_text_representation or numeric_value_out_of_range then
   raise exception 'load_import_invalid_command' using errcode='22023';
 end;
 v_source:=_payload->>'source_type'; v_file:=nullif(btrim(_payload->>'file_name'),'');
 if v_actor is null or _payload->>'actor_id' is distinct from v_actor::text or v_tenant is null
    or not coalesce(public.is_tenant_operator_or_admin(v_tenant),false) then
   raise exception 'load_import_not_authorized' using errcode='42501';
 end if;
 if v_request is null or v_source not in('spreadsheet','xml') or v_file is null or length(v_file)>255
    or v_file_count not between 1 and 1000 or jsonb_typeof(_payload->'loads') is distinct from 'array'
    or jsonb_typeof(_payload->'documents') is distinct from 'array'
    or jsonb_typeof(_payload->'unloading_charges') is distinct from 'array'
    or jsonb_array_length(_payload->'loads') not between 1 and 5000
    or jsonb_array_length(_payload->'documents')>20000 or jsonb_array_length(_payload->'unloading_charges')>20000 then
   raise exception 'load_import_invalid_command' using errcode='22023';
 end if;

 -- Complete preflight: all scalars, references and duplicate conflicts are checked before writes.
 for l in select value from jsonb_array_elements(_payload->'loads') loop
   if jsonb_typeof(l) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(l) k where k not in
       ('external_load_number','load_date','arrival_date','gross_cargo_cents','freight_cents','cte_count','legacy_status_text','expected_payment_date','closed_at'))
      or nullif(btrim(l->>'external_load_number'),'') is null or length(l->>'external_load_number')>120
      or jsonb_typeof(l->'gross_cargo_cents') is distinct from 'number' or (l->>'gross_cargo_cents')!~'^[0-9]+$'
      or jsonb_typeof(l->'freight_cents') is distinct from 'number' or (l->>'freight_cents')!~'^[0-9]+$'
      or jsonb_typeof(l->'cte_count') is distinct from 'number' or (l->>'cte_count')!~'^[0-9]+$'
      or (l->>'gross_cargo_cents')::numeric>99999999999999 or (l->>'freight_cents')::numeric>99999999999999
      or (l->>'cte_count')::numeric>1000000 or length(coalesce(l->>'legacy_status_text',''))>1000
      or (l->>'load_date' is not null and l->>'load_date'!~'^\d{4}-\d{2}-\d{2}$')
      or (l->>'arrival_date' is not null and l->>'arrival_date'!~'^\d{4}-\d{2}-\d{2}$')
      or (l->>'expected_payment_date' is not null and l->>'expected_payment_date'!~'^\d{4}-\d{2}-\d{2}$')
      or (l->>'closed_at' is not null and l->>'closed_at'!~'^\d{4}-\d{2}-\d{2}(T.*)?$') then
     raise exception 'load_import_invalid_load' using errcode='22023';
   end if;
   begin perform (l->>'load_date')::date,(l->>'arrival_date')::date,(l->>'expected_payment_date')::date,(l->>'closed_at')::timestamptz;
   exception when datetime_field_overflow then raise exception 'load_import_invalid_load' using errcode='22023'; end;
 end loop;

 if exists(select 1 from jsonb_array_elements(_payload->'loads') as x(value) group by upper(btrim(x.value->>'external_load_number'))
           having count(distinct (x.value-'external_load_number')::text)>1) then
   raise exception 'load_import_conflicting_load_duplicate' using errcode='22023';
 end if;

 for d in select value from jsonb_array_elements(_payload->'documents') loop
   if jsonb_typeof(d) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(d) k where k not in
       ('external_load_number','kind','access_key','number','issue_date','issuer_name','issuer_cnpj','recipient_name','recipient_cnpj',
        'origin_city','origin_state','destination_city','destination_state','cargo_cents','freight_cents','weight_grams','volume_milliunits',
        'freight_rate_ppm','referenced_nfe_keys'))
      or nullif(btrim(d->>'external_load_number'),'') is null or length(d->>'external_load_number')>120
      or d->>'kind' not in('nfe','cte')
      or (nullif(regexp_replace(coalesce(d->>'access_key',''),'\D','','g'),'') is null
          and (nullif(btrim(d->>'number'),'') is null or nullif(btrim(d->>'issuer_name'),'') is null))
      or (d->>'access_key' is not null and regexp_replace(d->>'access_key','\D','','g')!~'^\d{44}$')
      or (v_source='xml' and regexp_replace(coalesce(d->>'access_key',''),'\D','','g')!~'^\d{44}$')
      or jsonb_typeof(d->'cargo_cents') is distinct from 'number' or (d->>'cargo_cents')!~'^[0-9]+$'
      or jsonb_typeof(d->'freight_cents') is distinct from 'number' or (d->>'freight_cents')!~'^[0-9]+$'
      or jsonb_typeof(d->'weight_grams') is distinct from 'number' or (d->>'weight_grams')!~'^[0-9]+$'
      or jsonb_typeof(d->'volume_milliunits') is distinct from 'number' or (d->>'volume_milliunits')!~'^[0-9]+$'
      or jsonb_typeof(d->'referenced_nfe_keys') is distinct from 'array'
      or (jsonb_typeof(d->'freight_rate_ppm') not in('number','null'))
      or (jsonb_typeof(d->'freight_rate_ppm')='number' and ((d->>'freight_rate_ppm')!~'^[0-9]+$' or (d->>'freight_rate_ppm')::numeric>1000000))
      or (d->>'cargo_cents')::numeric>99999999999999 or (d->>'freight_cents')::numeric>99999999999999
      or (d->>'weight_grams')::numeric>999999999999999 or (d->>'volume_milliunits')::numeric>999999999999999
      or (d->>'issue_date' is not null and d->>'issue_date'!~'^\d{4}-\d{2}-\d{2}$') then
     raise exception 'load_import_invalid_document' using errcode='22023';
   end if;
   begin perform (d->>'issue_date')::date; exception when datetime_field_overflow then raise exception 'load_import_invalid_document' using errcode='22023'; end;
   if exists(select 1 from jsonb_array_elements(d->'referenced_nfe_keys') r where jsonb_typeof(r) is distinct from 'string' or regexp_replace(r#>>'{}','\D','','g')!~'^\d{44}$') then
     raise exception 'load_import_invalid_document' using errcode='22023';
   end if;
 end loop;

 if exists(select 1 from (select case when nullif(regexp_replace(coalesce(x.value->>'access_key',''),'\D','','g'),'') is not null
               then 'K:'||regexp_replace(x.value->>'access_key','\D','','g')
               else 'N:'||upper(btrim(x.value->>'external_load_number'))||':'||(x.value->>'kind')||':'||upper(regexp_replace(x.value->>'number','\s','','g'))||':'||upper(coalesce(x.value->>'issuer_name','')) end k,
               count(distinct (x.value-'access_key')::text) variants from jsonb_array_elements(_payload->'documents') as x(value) group by 1) q where variants>1) then
   raise exception 'load_import_conflicting_document_duplicate' using errcode='22023';
 end if;

 for u in select value from jsonb_array_elements(_payload->'unloading_charges') loop
   if jsonb_typeof(u) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(u) k where k not in
       ('external_load_number','invoice_number','client_name','supplier_name','city','service_date','amount_cents','suppliers'))
      or length(coalesce(u->>'external_load_number',''))>120 or length(coalesce(u->>'invoice_number',''))>60
      or length(coalesce(u->>'client_name',''))>255 or length(coalesce(u->>'supplier_name',''))>255
      or length(coalesce(u->>'city',''))>255
      or jsonb_typeof(u->'amount_cents') is distinct from 'number' or (u->>'amount_cents')!~'^[0-9]+$'
      or (u->>'amount_cents')::numeric>99999999999999 or jsonb_typeof(u->'suppliers') is distinct from 'array'
      or (u->>'service_date' is not null and u->>'service_date'!~'^\d{4}-\d{2}-\d{2}$') then
     raise exception 'load_import_invalid_unloading_charge' using errcode='22023';
   end if;
   begin perform (u->>'service_date')::date; exception when datetime_field_overflow then raise exception 'load_import_invalid_unloading_charge' using errcode='22023'; end;
   if exists(select 1 from jsonb_array_elements(u->'suppliers') as supplier(value)
             where jsonb_typeof(supplier.value) is distinct from 'string' or length(supplier.value#>>'{}')>255) then
     raise exception 'load_import_invalid_unloading_charge' using errcode='22023';
   end if;
 end loop;
 if exists(select 1 from (select upper(btrim(x.value->>'external_load_number')) n from jsonb_array_elements(_payload->'documents') as x(value)
                          union select upper(btrim(x.value->>'external_load_number')) from jsonb_array_elements(_payload->'unloading_charges') as x(value) where nullif(btrim(x.value->>'external_load_number'),'') is not null) refs
           where not exists(select 1 from jsonb_array_elements(_payload->'loads') as x(value) where upper(btrim(x.value->>'external_load_number'))=refs.n)) then
   raise exception 'load_import_unknown_load_reference' using errcode='23514';
 end if;

 v_hash:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('load-import-command'),hashtext(v_tenant::text||':'||v_actor::text||':'||v_request::text));
 perform tenant_id from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active
   and role::text in('owner','admin','operator') for share nowait;
 if not found then raise exception 'load_import_not_authorized' using errcode='42501'; end if;
 select * into v_previous from private.load_import_commands where tenant_id=v_tenant and actor_id=v_actor and request_id=v_request;
 if found then
   if v_previous.payload_hash<>v_hash then raise exception 'load_import_request_key_mismatch' using errcode='22023'; end if;
   return v_previous.response;
 end if;
 perform pg_advisory_xact_lock(hashtext('load-import-tenant'),hashtext(v_tenant::text));
 perform id from public.loads where tenant_id=v_tenant order by id for update nowait;
  perform id from public.fiscal_documents where tenant_id=v_tenant order by id for update nowait;

 -- Existing fiscal evidence can only be reused inside the same tenant/load graph.
 if exists(
   select 1 from jsonb_array_elements(_payload->'documents') as x(value)
   left join public.loads target on target.tenant_id=v_tenant
     and upper(target.external_load_number)=upper(btrim(x.value->>'external_load_number'))
   join public.fiscal_documents fiscal on fiscal.tenant_id=v_tenant and (
     (nullif(regexp_replace(coalesce(x.value->>'access_key',''),'\D','','g'),'') is not null
      and regexp_replace(coalesce(fiscal.access_key,''),'\D','','g')=regexp_replace(x.value->>'access_key','\D','','g'))
     or (nullif(regexp_replace(coalesce(x.value->>'access_key',''),'\D','','g'),'') is null
      and fiscal.document_type=case when x.value->>'kind'='nfe' then 'inbound' else 'cte' end
      and upper(regexp_replace(coalesce(fiscal.invoice_number,''),'\s','','g'))=upper(regexp_replace(x.value->>'number','\s','','g'))
      and upper(coalesce(fiscal.remitter,''))=upper(coalesce(x.value->>'issuer_name','')))
   )
   where fiscal.current_delivery_attempt_id is not null
      or (fiscal.load_id is not null and fiscal.load_id is distinct from target.id)
      or exists(select 1 from public.load_documents linked where linked.tenant_id=v_tenant
                and linked.fiscal_document_id=fiscal.id and linked.load_id is distinct from target.id)
 ) then raise exception 'load_import_document_graph_conflict' using errcode='23514'; end if;

 insert into public.load_import_batches(id,tenant_id,source_type,file_name,file_count,parsed_count,
   imported_count,duplicated_count,error_count,status,metadata,errors,created_by)
 values(v_batch,v_tenant,v_source,v_file,v_file_count,
   jsonb_array_length(_payload->'loads')+jsonb_array_length(_payload->'documents')+jsonb_array_length(_payload->'unloading_charges'),
   0,0,0,'processing',jsonb_build_object('request_id',v_request,'command_id',v_command),'[]'::jsonb,v_actor);

 for l in select distinct on(upper(btrim(value->>'external_load_number'))) value
          from jsonb_array_elements(_payload->'loads') order by upper(btrim(value->>'external_load_number')),value::text loop
   select * into v_existing from public.loads where tenant_id=v_tenant
    and upper(external_load_number)=upper(btrim(l->>'external_load_number')) for update;
   if found then
     select v_existing.receivable_id is not null or coalesce(v_existing.received_amount,0)<>0
       or v_existing.payment_date is not null
       or exists(select 1 from public.load_payments p where p.tenant_id=v_tenant and p.load_id=v_existing.id)
       into v_financial;
     update public.loads set
       load_date=coalesce((l->>'load_date')::date,load_date), arrival_date=coalesce((l->>'arrival_date')::date,arrival_date),
       legacy_status_text=coalesce(l->>'legacy_status_text',legacy_status_text), source_origin=v_source||'_import',
       last_import_batch_id=v_batch,
       gross_cargo_value=case when v_financial then gross_cargo_value else (l->>'gross_cargo_cents')::numeric/100 end,
       freight_amount=case when v_financial then freight_amount else (l->>'freight_cents')::numeric/100 end,
       expected_payment_date=case when v_financial then expected_payment_date else coalesce((l->>'expected_payment_date')::date,expected_payment_date) end,
       cte_count=greatest(cte_count,(l->>'cte_count')::integer), updated_at=clock_timestamp()
     where tenant_id=v_tenant and id=v_existing.id;
     u_load:=u_load+1;
   else
     insert into public.loads(tenant_id,load_number,external_load_number,status,load_date,arrival_date,
       gross_cargo_value,freight_amount,cte_count,legacy_status_text,expected_payment_date,
       source_origin,last_import_batch_id,created_by)
     values(v_tenant,btrim(l->>'external_load_number'),btrim(l->>'external_load_number'),'assembling',
       (l->>'load_date')::date,(l->>'arrival_date')::date,(l->>'gross_cargo_cents')::numeric/100,
       (l->>'freight_cents')::numeric/100,(l->>'cte_count')::integer,l->>'legacy_status_text',
       (l->>'expected_payment_date')::date,v_source||'_import',v_batch,v_actor);
     n_load:=n_load+1;
   end if;
 end loop;

 for d in select distinct on(case when nullif(regexp_replace(coalesce(value->>'access_key',''),'\D','','g'),'') is not null
             then 'K:'||regexp_replace(value->>'access_key','\D','','g')
             else 'N:'||upper(btrim(value->>'external_load_number'))||':'||(value->>'kind')||':'||
                  upper(regexp_replace(value->>'number','\s','','g'))||':'||upper(coalesce(value->>'issuer_name','')) end) value
          from jsonb_array_elements(_payload->'documents')
          order by case when nullif(regexp_replace(coalesce(value->>'access_key',''),'\D','','g'),'') is not null
             then 'K:'||regexp_replace(value->>'access_key','\D','','g')
             else 'N:'||upper(btrim(value->>'external_load_number'))||':'||(value->>'kind')||':'||
                  upper(regexp_replace(value->>'number','\s','','g'))||':'||upper(coalesce(value->>'issuer_name','')) end,value::text loop
   select id into strict v_load from public.loads where tenant_id=v_tenant
     and upper(external_load_number)=upper(btrim(d->>'external_load_number'));
   v_fiscal:=null;
   select id into v_fiscal from public.fiscal_documents where tenant_id=v_tenant and (
     (nullif(regexp_replace(coalesce(d->>'access_key',''),'\D','','g'),'') is not null
      and regexp_replace(coalesce(access_key,''),'\D','','g')=regexp_replace(d->>'access_key','\D','','g'))
     or (nullif(regexp_replace(coalesce(d->>'access_key',''),'\D','','g'),'') is null
      and document_type=case when d->>'kind'='nfe' then 'inbound' else 'cte' end
      and upper(regexp_replace(coalesce(invoice_number,''),'\s','','g'))=upper(regexp_replace(d->>'number','\s','','g'))
      and upper(coalesce(remitter,''))=upper(coalesce(d->>'issuer_name',''))))
     order by created_at limit 1;
   if v_fiscal is null then
     insert into public.fiscal_documents(tenant_id,document_type,invoice_number,access_key,remitter,remitter_cnpj,
       recipient,recipient_cnpj,issue_date,load_id,origin_city,origin_state,recipient_city,recipient_state,value,freight_value,
       weight_kg,volume_count,status,import_batch_id,imported_at,created_by)
     values(v_tenant,case when d->>'kind'='nfe' then 'inbound' else 'cte' end,nullif(btrim(d->>'number'),''),
       nullif(regexp_replace(coalesce(d->>'access_key',''),'\D','','g'),''),nullif(btrim(d->>'issuer_name'),''),
       nullif(regexp_replace(coalesce(d->>'issuer_cnpj',''),'\D','','g'),''),nullif(btrim(d->>'recipient_name'),''),
       nullif(regexp_replace(coalesce(d->>'recipient_cnpj',''),'\D','','g'),''),(d->>'issue_date')::date,v_load,
       nullif(btrim(d->>'origin_city'),''),nullif(upper(btrim(d->>'origin_state')),''),
       nullif(btrim(d->>'destination_city'),''),nullif(upper(btrim(d->>'destination_state')),''),
       (d->>'cargo_cents')::numeric/100,(d->>'freight_cents')::numeric/100,(d->>'weight_grams')::numeric/1000,
       (d->>'volume_milliunits')::numeric/1000,'pending',v_batch::text,clock_timestamp(),v_actor)
     returning id into v_fiscal;
   elsif not exists(select 1 from public.load_documents where tenant_id=v_tenant and fiscal_document_id=v_fiscal) then
     update public.fiscal_documents set load_id=v_load,updated_at=clock_timestamp()
      where tenant_id=v_tenant and id=v_fiscal and load_id is null;
   end if;

   if exists(select 1 from public.load_documents where tenant_id=v_tenant and load_id=v_load and fiscal_document_id=v_fiscal) then
     d_doc:=d_doc+1;
   else
     insert into public.load_documents(tenant_id,load_id,fiscal_document_id,document_type,document_number,access_key,
       issue_date,issuer_name,issuer_cnpj,recipient_name,recipient_cnpj,origin_city,origin_state,destination_city,destination_state,
       cargo_value,freight_value,weight_kg,volume_count,metadata)
     values(v_tenant,v_load,v_fiscal,d->>'kind',nullif(btrim(d->>'number'),''),
       nullif(regexp_replace(coalesce(d->>'access_key',''),'\D','','g'),''),(d->>'issue_date')::date,
       nullif(btrim(d->>'issuer_name'),''),nullif(regexp_replace(coalesce(d->>'issuer_cnpj',''),'\D','','g'),''),
       nullif(btrim(d->>'recipient_name'),''),nullif(regexp_replace(coalesce(d->>'recipient_cnpj',''),'\D','','g'),''),
       nullif(btrim(d->>'origin_city'),''),nullif(upper(btrim(d->>'origin_state')),''),
       nullif(btrim(d->>'destination_city'),''),nullif(upper(btrim(d->>'destination_state')),''),
       (d->>'cargo_cents')::numeric/100,(d->>'freight_cents')::numeric/100,(d->>'weight_grams')::numeric/1000,
       (d->>'volume_milliunits')::numeric/1000,
       jsonb_build_object('source',v_source,'batch_id',v_batch,'freight_rate_ppm',d->'freight_rate_ppm','referenced_nfe_keys',d->'referenced_nfe_keys'));
     n_doc:=n_doc+1;
     if jsonb_typeof(d->'freight_rate_ppm')='number' then n_rate:=n_rate+1; end if;
   end if;
   if d->>'kind'='nfe' then
     if exists(select 1 from public.load_items where tenant_id=v_tenant and load_id=v_load
               and fiscal_document_id=v_fiscal and delivery_attempt_id is null) then d_item:=d_item+1;
     else
       insert into public.load_items(tenant_id,load_id,fiscal_document_id,item_description,quantity,pallet_count,weight_kg,volume_m3,status)
       values(v_tenant,v_load,v_fiscal,left('Documento NF-e '||coalesce(d->>'number',d->>'access_key'),500),1,0,
         (d->>'weight_grams')::numeric/1000,0,'pending');
       n_item:=n_item+1;
     end if;
   end if;
 end loop;

 for u in select value from jsonb_array_elements(_payload->'unloading_charges') group by value order by value loop
   v_load:=null; v_fiscal:=null;
   if nullif(btrim(u->>'external_load_number'),'') is not null then
     select id into strict v_load from public.loads where tenant_id=v_tenant
       and upper(external_load_number)=upper(btrim(u->>'external_load_number'));
   end if;
   if v_load is not null and nullif(btrim(u->>'invoice_number'),'') is not null then
     select fiscal_document_id into v_fiscal from public.load_documents where tenant_id=v_tenant and load_id=v_load
       and upper(regexp_replace(coalesce(document_number,''),'\s','','g'))=upper(regexp_replace(u->>'invoice_number','\s','','g'))
       order by created_at limit 1;
   end if;
   if exists(select 1 from public.load_unloading_charges c where c.tenant_id=v_tenant
       and c.load_id is not distinct from v_load and c.fiscal_document_id is not distinct from v_fiscal
       and upper(coalesce(c.invoice_number,''))=upper(coalesce(u->>'invoice_number',''))
       and upper(coalesce(c.client_name,''))=upper(coalesce(u->>'client_name',''))
       and upper(coalesce(c.supplier_name,''))=upper(coalesce(u->>'supplier_name',''))
       and upper(coalesce(c.city,''))=upper(coalesce(u->>'city',''))
       and c.service_date is not distinct from (u->>'service_date')::date
       and c.amount=(u->>'amount_cents')::numeric/100
       and coalesce(c.metadata->'suppliers','[]'::jsonb)=u->'suppliers') then d_unload:=d_unload+1;
   else
     insert into public.load_unloading_charges(tenant_id,load_id,fiscal_document_id,invoice_number,client_name,
       supplier_name,city,service_date,amount,status,import_batch_id,metadata,created_by)
     values(v_tenant,v_load,v_fiscal,nullif(btrim(u->>'invoice_number'),''),nullif(btrim(u->>'client_name'),''),
       nullif(btrim(u->>'supplier_name'),''),nullif(btrim(u->>'city'),''),(u->>'service_date')::date,
       (u->>'amount_cents')::numeric/100,'pending',v_batch,
       jsonb_build_object('source',v_source,'batch_id',v_batch,'suppliers',u->'suppliers'),v_actor);
     n_unload:=n_unload+1;
   end if;
 end loop;

 -- Projection totals are rebuilt from the final graph, never from only the new rows.
 update public.loads target set total_weight_kg=totals.weight_kg,invoice_count=totals.invoice_count,
   cte_count=greatest(target.cte_count,totals.cte_count),updated_at=clock_timestamp()
 from(select ld.load_id,sum(ld.weight_kg) weight_kg,
       count(*) filter(where ld.document_type='nfe')::integer invoice_count,
       count(*) filter(where ld.document_type='cte')::integer cte_count
      from public.load_documents ld where ld.tenant_id=v_tenant
       and exists(select 1 from jsonb_array_elements(_payload->'loads') as x(value) join public.loads l2 on l2.id=ld.load_id and l2.tenant_id=v_tenant
                  where upper(l2.external_load_number)=upper(btrim(x.value->>'external_load_number')))
      group by ld.load_id) totals
 where target.tenant_id=v_tenant and target.id=totals.load_id;

 v_response:=jsonb_build_object(
   'version',1,'tenant_id',v_tenant,'actor_id',v_actor,'request_id',v_request,'confirmed',true,
   'command_id',v_command,'batch_id',v_batch,
   'preview',jsonb_build_object('newLoads',n_load,'updatedLoads',u_load,'newDocuments',n_doc,
     'duplicated',d_doc+d_item+d_unload,'pending',0,'errors','[]'::jsonb),
   'counts',jsonb_build_object('new_items',n_item,'duplicate_items',d_item,'new_unloading_charges',n_unload,
     'duplicate_unloading_charges',d_unload,'freight_rates',n_rate));
 update public.load_import_batches set imported_count=n_doc+n_unload,
   duplicated_count=d_doc+d_item+d_unload,error_count=0,status='completed',metadata=v_response,errors='[]'::jsonb
 where tenant_id=v_tenant and id=v_batch;
 insert into private.load_import_commands(id,tenant_id,actor_id,request_id,payload_hash,batch_id,response)
 values(v_command,v_tenant,v_actor,v_request,v_hash,v_batch,v_response);
 return v_response;
exception when lock_not_available or deadlock_detected then
 raise exception 'load_import_concurrent_change' using errcode='40001';
end;$fn$;

comment on function public.apply_load_import_command(jsonb) is
 'Atomic, idempotent operator load import. Existing status and payment evidence are server-owned and preserved.';
revoke all on function public.apply_load_import_command(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.apply_load_import_command(jsonb) to authenticated;
