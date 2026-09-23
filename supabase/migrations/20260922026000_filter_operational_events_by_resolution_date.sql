-- Let occurrence presets choose whether their civil-date interval applies to
-- creation or resolution, while preserving the cursor's stable creation order.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $migration$
declare
  function_oid regprocedure := to_regprocedure('public.list_operational_events_page_v1(uuid,jsonb,integer,jsonb)');
  definition text;
  previous_definition text;
begin
  if function_oid is null then
    raise exception 'Operational-event cursor reader dependency is missing';
  end if;

  select pg_get_functiondef(function_oid) into definition;

  previous_definition := definition;
  definition := replace(
    definition,
    $$'impact_min','impact_max','has_impact','date_from','date_to','search','responsibility'$$,
    $$'impact_min','impact_max','has_impact','date_from','date_to','date_basis','search','responsibility'$$
  );
  if definition = previous_definition then
    raise exception 'Could not extend operational-event filter whitelist';
  end if;

  previous_definition := definition;
  definition := replace(
    definition,
    $$'load_id','date_from','date_to','search','responsibility')$$,
    $$'load_id','date_from','date_to','date_basis','search','responsibility')$$
  );
  if definition = previous_definition then
    raise exception 'Could not validate operational-event date basis type';
  end if;

  previous_definition := definition;
  definition := replace(
    definition,
    E'  v_to timestamptz;\n  v_search text;',
    E'  v_to timestamptz;\n  v_date_basis text;\n  v_search text;'
  );
  if definition = previous_definition then
    raise exception 'Could not declare operational-event date basis';
  end if;

  previous_definition := definition;
  definition := replace(
    definition,
    E'  v_to := nullif(v_filters->>''date_to'', '''')::timestamptz;\n  v_search :=',
    E'  v_to := nullif(v_filters->>''date_to'', '''')::timestamptz;\n  v_date_basis := coalesce(nullif(v_filters->>''date_basis'', ''''), ''created_at'');\n  v_search :='
  );
  if definition = previous_definition then
    raise exception 'Could not read operational-event date basis';
  end if;

  previous_definition := definition;
  definition := replace(
    definition,
    $$or v_responsibility not in ('all','deposito','transporte')$$,
    $$or v_date_basis not in ('created_at','resolved_at')
    or v_responsibility not in ('all','deposito','transporte')$$
  );
  if definition = previous_definition then
    raise exception 'Could not validate operational-event date basis value';
  end if;

  previous_definition := definition;
  definition := replace(
    definition,
    'v_from is null or e.created_at >= v_from',
    'v_from is null or (case v_date_basis when ''resolved_at'' then e.resolved_at else e.created_at end) >= v_from'
  );
  if definition = previous_definition then
    raise exception 'Could not switch operational-event lower date predicate';
  end if;

  previous_definition := definition;
  definition := replace(
    definition,
    'v_to is null or e.created_at <= v_to',
    'v_to is null or (case v_date_basis when ''resolved_at'' then e.resolved_at else e.created_at end) <= v_to'
  );
  if definition = previous_definition then
    raise exception 'Could not switch operational-event upper date predicate';
  end if;

  execute definition;
end;
$migration$;

comment on function public.list_operational_events_page_v1(uuid,jsonb,integer,jsonb) is
  'Operator-only, tenant-scoped stable cursor reader. Date bounds may target created_at or resolved_at; the cursor remains bound to tenant and exact filters.';
