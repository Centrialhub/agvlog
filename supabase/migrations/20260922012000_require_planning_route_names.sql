create or replace function public.require_route_planning_draft_name_v1()
returns trigger language plpgsql set search_path='' as $function$
begin
  new.name:=nullif(btrim(new.name),'');
  if new.name is null then raise exception 'route_name_required' using errcode='23514';end if;
  return new;
end;$function$;

drop trigger if exists require_route_planning_draft_name_v1 on public.route_planning_drafts;
create trigger require_route_planning_draft_name_v1 before insert or update of name on public.route_planning_drafts
for each row execute function public.require_route_planning_draft_name_v1();

-- dispatch_planned_route, v2 and v3 all converge on the planned trip insert.
-- Keeping the invariant at that write boundary also protects direct RPC calls.
create or replace function public.require_planned_dispatch_route_name_v1()
returns trigger language plpgsql set search_path='' as $function$
begin
  if new.status='planned' and new.notes is not null then
    if btrim(new.notes)='' then raise exception 'route_name_required' using errcode='23514';end if;
    new.notes:=btrim(new.notes);
  end if;
  return new;
end;$function$;

drop trigger if exists require_planned_dispatch_route_name_v1 on public.dispatch_trips;
create trigger require_planned_dispatch_route_name_v1 before insert or update of notes,status on public.dispatch_trips
for each row execute function public.require_planned_dispatch_route_name_v1();
