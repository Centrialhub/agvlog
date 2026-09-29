do $$
begin
  if to_regclass('public.pois') is null then
    raise exception 'pois_table_contract_not_found';
  end if;
  if to_regclass('public.idx_pois_tenant_dedupe') is null then
    raise exception 'poi_dedupe_index_contract_not_found';
  end if;
end;
$$;

drop index public.idx_pois_tenant_dedupe;

-- PostgreSQL permits multiple NULL values in a regular unique index. Keeping the
-- same columns without a partial predicate makes PostgREST's ON CONFLICT target
-- inferable while preserving rows that intentionally have no dedupe key.
create unique index idx_pois_tenant_dedupe
  on public.pois (tenant_id, dedupe_key);
