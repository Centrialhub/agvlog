create or replace function public.fiscal_documents_enforce_single_outbound()
returns trigger
language plpgsql
security definer
  SET search_path = public
set search_path = public
as $$
begin
  if new.cte_emitted_at is not null and new.nfse_emitted_at is not null then
    raise exception 'NF % ja possui documento de saida (CT-e ou NFS-e). Cancele o documento existente antes de emitir outro.', coalesce(new.invoice_number, new.id::text)
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fiscal_documents_single_outbound on public.fiscal_documents;
create trigger trg_fiscal_documents_single_outbound
before insert or update of cte_emitted_at, nfse_emitted_at on public.fiscal_documents
for each row execute function public.fiscal_documents_enforce_single_outbound();
-- linter:allow-no-tenant legacy-migration 2026-12-31
