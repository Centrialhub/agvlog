do $migration$
declare
  definition text;
  changed text;
  marker text := $old$'movement_page',jsonb_build_object('offset',_movement_offset,'limit',page_limit,'total',movement_total),$old$;
  replacement text := $new$'movement_page',jsonb_build_object('offset',_movement_offset,'limit',page_limit,'total',movement_total),
  'movement_receipt_summary',jsonb_build_object(
    'identified',(select count(*) from jsonb_array_elements(
      case when jsonb_typeof(c.snapshot#>'{facts,movements}')='array' then c.snapshot#>'{facts,movements}' else '[]'::jsonb end
    ) movement where nullif(btrim(movement->>'receipt_path'),'') is not null),
    'missing',(select count(*) from jsonb_array_elements(
      case when jsonb_typeof(c.snapshot#>'{facts,movements}')='array' then c.snapshot#>'{facts,movements}' else '[]'::jsonb end
    ) movement where nullif(btrim(movement->>'receipt_path'),'') is null)
  ),$new$;
begin
  select pg_get_functiondef('public.get_finance_account_period_evidence_page(uuid,uuid,uuid,integer,integer,integer)'::regprocedure)
  into definition;
  changed:=replace(definition,marker,replacement);
  if changed=definition then
    raise exception 'account_period_movement_page_contract_changed' using errcode='55000';
  end if;
  execute changed;
end;
$migration$;

comment on function public.get_finance_account_period_evidence_page(uuid,uuid,uuid,integer,integer,integer) is
  'Returns bounded evidence pages plus integral movement-receipt counts from the immutable closing snapshot.';
