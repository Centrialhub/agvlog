-- Every authenticated planner writes a planned trip through this boundary.
-- The previous trigger skipped NULL notes and let unnamed trips through.
create or replace function public.require_planned_dispatch_route_name_v1()
returns trigger language plpgsql set search_path = ''
as $function$
begin
  if new.status = 'planned' then
    new.notes := nullif(btrim(new.notes), '');
    if new.notes is null then
      raise exception 'route_name_required' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;
