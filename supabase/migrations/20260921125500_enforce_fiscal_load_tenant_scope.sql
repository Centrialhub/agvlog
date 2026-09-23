create unique index if not exists loads_id_tenant_uidx
  on public.loads (id, tenant_id);

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fiscal_documents'::regclass
      and conname = 'fiscal_documents_load_tenant_fkey'
  ) then
    alter table public.fiscal_documents
      add constraint fiscal_documents_load_tenant_fkey
      foreign key (load_id, tenant_id)
      references public.loads (id, tenant_id)
      not valid;
  end if;
end;
$constraint$;

do $patch$
declare
  signature regprocedure := 'public.search_client_portal_shipments_v2(uuid,uuid,text,text[],date,date,text,text,boolean,boolean,integer,integer)'::regprocedure;
  body text;
  needle text := 'LEFT JOIN public.loads l ON l.id = fd.load_id';
  replacement text := 'LEFT JOIN public.loads l ON l.id = fd.load_id AND l.tenant_id = fd.tenant_id';
begin
  select pg_get_functiondef(signature) into body;
  if position(replacement in body) > 0 then return; end if;
  if position(needle in body) = 0 then raise exception 'portal_shipment_load_join_contract_changed'; end if;
  execute replace(body, needle, replacement);
end;
$patch$;
