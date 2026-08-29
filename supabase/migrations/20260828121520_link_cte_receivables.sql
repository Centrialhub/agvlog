alter table public.receivables
  add column if not exists cte_document_id uuid;

create unique index if not exists cte_documents_tenant_id_id_uidx
  on public.cte_documents (tenant_id, id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'receivables_tenant_cte_document_fkey'
      and conrelid = 'public.receivables'::regclass
  ) then
    alter table public.receivables
      add constraint receivables_tenant_cte_document_fkey
      foreign key (tenant_id, cte_document_id)
      references public.cte_documents (tenant_id, id)
      on delete set null (cte_document_id);
  end if;
end
$$;

create unique index if not exists receivables_tenant_cte_document_uidx
  on public.receivables (tenant_id, cte_document_id);
