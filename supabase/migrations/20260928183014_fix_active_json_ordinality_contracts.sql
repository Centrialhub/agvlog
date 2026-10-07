-- Restore two active JSON operations found by linting the live-equivalent schema.
-- Preserve captured bodies and historical bodies with the receipt-summary hotfix.
-- Accept only the two reviewed exact pallet forms; change only JSON expansion.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $fix_json_ordinality$
declare
  target record;
  function_oid oid;
  definition text;
  changed text;
  variant integer;
  original_count integer;
  corrected_count integer;
begin
  for target in select * from (values
    (
      'public.edit_pallet_return_protocol_v1(jsonb)',
      false,
      array[$pallet_old$from jsonb_to_recordset(v_items) with ordinality as x(
      pallet_type_id uuid,pallet_type_code text,pallet_type_name text,pallet_color text,
      quantity numeric,notes text,sort_order integer,ord bigint
    )$pallet_old$,
      $pallet_captured_old$from jsonb_to_recordset(v_items) with ordinality as x(pallet_type_id uuid,pallet_type_code text,pallet_type_name text,pallet_color text,quantity numeric,notes text,sort_order integer,ord bigint)$pallet_captured_old$],
      array[$pallet_new$from jsonb_array_elements(v_items) with ordinality as item(value,ord)
    cross join lateral jsonb_to_record(item.value) as x(
      pallet_type_id uuid,pallet_type_code text,pallet_type_name text,pallet_color text,
      quantity numeric,notes text,sort_order integer
    )$pallet_new$,
      $pallet_captured_new$from jsonb_array_elements(v_items) with ordinality as item(value,ord) cross join lateral jsonb_to_record(item.value) as x(pallet_type_id uuid,pallet_type_code text,pallet_type_name text,pallet_color text,quantity numeric,notes text,sort_order integer)$pallet_captured_new$]
    ),
    (
      'public.get_finance_account_period_evidence_page(uuid,uuid,uuid,integer,integer,integer)',
      true,
      array[$page_old$from jsonb_array_elements(case when jsonb_typeof(c.snapshot#>'{facts,movements}')='array' then c.snapshot#>'{facts,movements}' else '[]'::jsonb end) with ordinality
  where ordinal > _movement_offset$page_old$],
      array[$page_new$from jsonb_array_elements(case when jsonb_typeof(c.snapshot#>'{facts,movements}')='array' then c.snapshot#>'{facts,movements}' else '[]'::jsonb end) with ordinality as movement(value,ordinal)
  where ordinal > _movement_offset$page_new$]
    )
  ) as patch(signature, expected_definer, originals, corrected)
  loop
    function_oid := pg_catalog.to_regprocedure(target.signature);
    if function_oid is null or not exists (
      select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_language l on l.oid=p.prolang
      where p.oid=function_oid and p.prokind='f'
        and p.prorettype='pg_catalog.jsonb'::pg_catalog.regtype
        and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
        and p.prosecdef=target.expected_definer and l.lanname='plpgsql'
    ) then
      raise exception 'JSON ordinality contract changed: %', target.signature using errcode='55000';
    end if;
    definition := pg_catalog.pg_get_functiondef(function_oid);
    changed := definition;
    original_count := 0;
    corrected_count := 0;
    for variant in 1..array_length(target.originals,1) loop
      original_count := original_count+(length(definition)-length(replace(definition,target.originals[variant],'')))/length(target.originals[variant]);
      corrected_count := corrected_count+(length(definition)-length(replace(definition,target.corrected[variant],'')))/length(target.corrected[variant]);
      changed := replace(changed,target.originals[variant],target.corrected[variant]);
    end loop;
    if original_count=1 and corrected_count=0 then
      execute changed;
    elsif original_count<>0 or corrected_count<>1 then
      raise exception 'JSON ordinality body changed: %', target.signature using errcode='55000';
    end if;
  end loop;
end;
$fix_json_ordinality$;
