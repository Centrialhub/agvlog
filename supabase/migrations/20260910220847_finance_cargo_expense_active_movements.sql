-- Keep the canonical cargo-release gate while excluding invalidated outgoing
-- movements from expense candidates. Original money and correction history stay intact.
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare
  body text;
  raw_source text:='from public.finance_movements movement';
  active_source text:='from finance_private.active_movements movement';
  raw_count integer;
  active_count integer;
begin
  if to_regclass('finance_private.active_movements') is null then
    raise exception 'finance_active_movement_reader_missing';
  end if;
  body:=pg_get_functiondef(to_regprocedure('finance_private.expense_options(uuid,text,text,uuid,integer)'));
  if body is null or position('private.trip_cargo_is_closed_v1' in body)=0 then
    raise exception 'finance_cargo_expense_options_contract_changed';
  end if;
  raw_count:=(length(body)-length(replace(body,raw_source,'')))/length(raw_source);
  active_count:=(length(body)-length(replace(body,active_source,'')))/length(active_source);
  if raw_count=0 and active_count=1 then return;end if;
  if raw_count<>1 or active_count<>0 then
    raise exception 'finance_cargo_expense_options_source_changed';
  end if;
  execute replace(body,raw_source,active_source);
end;
$patch$;