-- LOCAL REHEARSAL ONLY. Restore the immediately preceding composition/delivery candidate.
-- Refuses after ANY recorded replanning or other use of response_body. Prefer roll-forward.
-- Does not reverse business transfers, delete evidence, clear cache or authorize publication.
-- Coordinate frontend compatibility. Run as ONE transaction, never remove guards.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Serialize with every replanning request before examining usage or removing its API.
lock table public.idempotency_keys in access exclusive mode;
do $recovery_guard$
declare expected record;target oid;
begin
 -- PL/pgSQL body dependencies are not all tracked by DROP FUNCTION. Refuse
 -- even an unused newer document API before removing its helpers/cache column.
 if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in(
  '_lock_load_document_graph','_load_document_change_snapshot','_change_load_documents',
  'get_load_document_change_context','change_load_documents')) then
   raise exception 'Replanning recovery refused: newer document composition APIs exist; recover in reverse order';
 end if;
 for expected in select * from(values
  ('public._assert_load_replanning_graph(uuid,uuid[])','88587d953ac20149f3beb9a825d42275',false,false),
  ('public._derive_driver_delivery_result(uuid,uuid)','31a4a4ec4f9a00f7bf7df2f96ede223a',false,false),
  ('public._load_is_locked(uuid)','a15b8a40dfd93a05479f8cc0b04db3eb',false,true),
  ('public._load_replanning_snapshot(uuid,uuid[])','805fbe6706cde044e5904baaf6edea52',false,false),
  ('public.delete_load_if_empty(uuid)','7e103b5a3c3c898aed492644c527c993',false,true),
  ('public.get_load_replanning_context(uuid,uuid,uuid)','54fb4c85f58c8e8fb2c983760f88181b',true,false),
  ('public.guard_trip_load_link_graph()','020ab0928aa3b624f2cdbb2f10eee329',false,false),
  ('public.is_tenant_operator_or_admin(uuid)','682f66029dc9bb798f9f329b4e8f95aa',true,true),
  ('public.move_load_items_between_loads(uuid,uuid,uuid,uuid[])','7ac9704abb7f610328b22b1e9f129d99',true,true),
  ('public.recalc_load_totals()','7dc12046ecada4d2f04bb2942a92493d',false,true),
  ('public.replan_load_items(jsonb)','8dbd165b7b03de00262955d5a8d3082b',true,false)
 ) contract(signature,hash,authenticated,service_role) loop
  target:=to_regprocedure(expected.signature);
  if md5(replace(pg_get_functiondef(target),E'\r\n',E'\n')) is distinct from expected.hash
   or has_function_privilege('anon',target,'execute')
   or has_function_privilege('authenticated',target,'execute') is distinct from expected.authenticated
   or has_function_privilege('service_role',target,'execute') is distinct from expected.service_role then
    raise exception 'Replanning recovery refused: contract changed %',expected.signature;
  end if;
 end loop;
 if not exists(select 1 from pg_attribute where attrelid='public.idempotency_keys'::regclass and attname='response_body'
   and atttypid='jsonb'::regtype and not attnotnull and not attisdropped and not atthasdef)
  or not exists(select 1 from pg_class where oid='public.idempotency_keys'::regclass and relrowsecurity)
  or exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass and polcmd<>'r')
  or not exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass and polname='agvlog_select_authenticated'
   and md5(replace(pg_get_expr(polqual,polrelid),E'\r\n',E'\n'))='a5e2fc2cb8bbeb71640ea0bc13d8b3a8') then
   raise exception 'Replanning recovery refused: request cache changed';
 end if;
 if exists(select 1 from public.idempotency_keys where operation='replan_load_items' or response_body is not null)
  or exists(select 1 from public.entity_audit_log where action in('replan_items_out','replan_items_in')) then
   raise exception 'Replanning recovery refused: business usage exists; roll forward without deleting history';
 end if;
end;
$recovery_guard$;
CREATE OR REPLACE FUNCTION public._derive_driver_delivery_result(p_tenant_id uuid, p_trip_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_trip public.dispatch_trips%rowtype; v_load public.loads%rowtype; v_count integer;
  v_statuses text[]; v_result text; v_all_terminal boolean; v_missing boolean := false;
begin
  select * into v_trip from public._lock_delivery_trip_graph(p_tenant_id,p_trip_id);
  if v_trip.actual_start_at is null or v_trip.status is null or v_trip.status not in('in_transit','in_progress','completed') then
    raise exception 'Viagem sem início válido para concluir entregas' using errcode='23514';
  end if;
  select count(*) into v_count from public.dispatch_trip_loads where dispatch_trip_id=p_trip_id and tenant_id=p_tenant_id;
  select coalesce(bool_and(coalesce(status in('completed','delivered','cancelled','skipped','refused','returned','partial_delivery','failed'),false)),false)
    into v_all_terminal from public.dispatch_stops where dispatch_trip_id=p_trip_id and tenant_id=p_tenant_id;
  if v_count=0 then raise exception 'Viagem sem cargas vinculadas' using errcode='23514'; end if;
  -- A single-load trip unambiguously owns its stops. Shared trips require explicit document allocations.
  if v_count>1 and v_all_terminal and exists(select 1 from public.dispatch_stops s
    where s.dispatch_trip_id=p_trip_id and not exists(select 1 from public.dispatch_stop_documents d
      join public.fiscal_documents f on f.id=d.fiscal_document_id
      where d.dispatch_stop_id=s.id and coalesce(d.load_id,f.load_id) is not null)) then
    raise exception 'Parada sem carga identificada; revise os vínculos antes de concluir' using errcode='23514';
  end if;
  for v_load in select l.* from public.loads l join public.dispatch_trip_loads tl on tl.load_id=l.id
    where tl.dispatch_trip_id=p_trip_id and tl.tenant_id=p_tenant_id order by l.id loop
    -- A partial stop can fully deliver one document/load and return another.
    -- Use document outcomes for that stop, not its aggregate label for every load.
    select array_agg(case when s.status='partial_delivery' then (
      select public._delivery_result_from_statuses(array_agg(f.status))
      from public.dispatch_stop_documents d join public.fiscal_documents f on f.id=d.fiscal_document_id
      where d.dispatch_stop_id=s.id and d.tenant_id=p_tenant_id
        and (v_count=1 or coalesce(d.load_id,f.load_id)=v_load.id)
    ) else s.status end) into v_statuses from public.dispatch_stops s
    where s.dispatch_trip_id=p_trip_id and s.tenant_id=p_tenant_id and (v_count=1 or exists(
      select 1 from public.dispatch_stop_documents d join public.fiscal_documents f on f.id=d.fiscal_document_id
      where d.dispatch_stop_id=s.id and d.tenant_id=p_tenant_id and coalesce(d.load_id,f.load_id)=v_load.id));
    v_result := public._delivery_result_from_statuses(v_statuses);
    if coalesce(cardinality(v_statuses),0)=0 or (v_all_terminal and v_result is null) then v_missing:=true; end if;
    if v_result is not null and v_load.status is distinct from v_result then
      if v_load.status in('delivered','cancelled','returned','refused','partial_delivery','failed') then
        raise exception 'Carga possui resultado final divergente; solicite revisão' using errcode='23514';
      end if;
      update public.loads set status=v_result,updated_at=clock_timestamp() where id=v_load.id and tenant_id=p_tenant_id;
      perform public._log_entity_audit(p_tenant_id,'load',v_load.id,'status_change',
        jsonb_build_object('status',v_load.status),jsonb_build_object('status',v_result,'trip_id',p_trip_id),'delivery_outcome');
    end if;
  end loop;
  if v_all_terminal then
    if v_missing then raise exception 'Carga sem parada identificada; revise os vínculos antes de concluir' using errcode='23514'; end if;
    if v_trip.actual_start_at is null then raise exception 'Viagem sem início registrado' using errcode='23514'; end if;
    update public.dispatch_trips set status='completed',actual_end_at=coalesce(actual_end_at,clock_timestamp()),updated_at=clock_timestamp()
      where id=p_trip_id and tenant_id=p_tenant_id and status<>'completed';
  end if;
end;
$function$
;
revoke all on function public._derive_driver_delivery_result(uuid,uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.delete_load_if_empty(v_load_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_tenant_id uuid;
begin
  if v_load_id is null then return;end if;
  select tenant_id into v_tenant_id from public.loads where id=v_load_id for update nowait;
  if not found then return;end if;
  -- Documents are not the whole composition. Never delete remaining manual cargo.
  if exists(select 1 from public.load_items where load_id=v_load_id)
    or exists(select 1 from public.fiscal_documents where load_id=v_load_id and deleted_at is null and status is distinct from 'deleted') then
    return;
  end if;
  perform public.delete_load_safely(v_tenant_id,v_load_id);
exception when others then
  -- Preserve the legacy best-effort cleanup contract. Integrity/lock rejection
  -- leaves the empty load intact; it must never turn into a forced delete.
  return;
end;
$function$
;
revoke all on function public.delete_load_if_empty(uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_load_if_empty(uuid) to service_role;
drop function public.get_load_replanning_context(uuid,uuid,uuid);
drop function public.replan_load_items(jsonb);
drop function public._load_replanning_snapshot(uuid,uuid[]);
drop function public._assert_load_replanning_graph(uuid,uuid[]);
alter table public.idempotency_keys drop column response_body;
commit;
