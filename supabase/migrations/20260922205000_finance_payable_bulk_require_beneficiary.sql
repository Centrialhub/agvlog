do $migration$
declare
  definition text;
  needle text := '  if beneficiary_count <> 1 then';
begin
  definition := pg_get_functiondef('finance_private.payable_bulk_context(uuid,uuid,jsonb)'::regprocedure);
  if position(needle in definition) = 0 then
    raise exception 'finance_payable_bulk_context_beneficiary_guard_missing';
  end if;
  definition := replace(definition, needle,
    '  if exists (
    select 1 from jsonb_array_elements(_items) item_row
    join public.payables p on p.tenant_id = _tenant and p.id = (item_row->>''payable_id'')::uuid
    where p.supplier_id is null and nullif(btrim(p.supplier_name), '''') is null
  ) then
    raise exception ''finance_payable_bulk_beneficiary_missing'' using errcode = ''22023'';
  end if;
' || needle);
  execute definition;
end
$migration$;
