begin;

-- A PL/pgSQL row variable named "a" shadowed the allocation table alias in
-- the movement-void branch. Repair only that reviewed fragment and abort on
-- any unexpected predecessor definition.
do $repair$
declare
  _definition text := pg_get_functiondef('finance_private.guard_open_complement_source()'::regprocedure);
  _old_fragment text := 'select a.expense_id into expense from public.finance_expense_allocations a join finance_private.expense_open_complement_amendments j on j.tenant_id=a.tenant_id and j.expense_id=a.expense_id where a.tenant_id=t and a.movement_id=(row_data->>''movement_id'')::uuid limit 1;';
  _new_fragment text := 'select alloc.expense_id into expense from public.finance_expense_allocations alloc join finance_private.expense_open_complement_amendments j on j.tenant_id=alloc.tenant_id and j.expense_id=alloc.expense_id where alloc.tenant_id=t and alloc.movement_id=(row_data->>''movement_id'')::uuid limit 1;';
begin
  if md5(_definition) <> '3ca7c5d8a939bcaa04ea60ae7045583f'
     or position(_old_fragment in _definition) = 0
     or position(_new_fragment in _definition) > 0
  then
    raise exception 'finance_open_complement_guard_unexpected_definition' using errcode = '23514';
  end if;

  execute replace(_definition, _old_fragment, _new_fragment);

  if position(_new_fragment in pg_get_functiondef('finance_private.guard_open_complement_source()'::regprocedure)) = 0
     or (
       select not p.prosecdef
          or p.proconfig is distinct from array['search_path=""']::text[]
          or p.proacl is distinct from '{postgres=X/postgres}'::aclitem[]
          or pg_get_userbyid(p.proowner) <> 'postgres'
       from pg_catalog.pg_proc p
       where p.oid = 'finance_private.guard_open_complement_source()'::regprocedure
     )
  then
    raise exception 'finance_open_complement_guard_repair_failed' using errcode = '23514';
  end if;
end
$repair$;

commit;
