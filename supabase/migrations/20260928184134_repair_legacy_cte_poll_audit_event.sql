-- The legacy CT-e poll updates fiscal_documents, not the cte_documents catalog.
-- vehicle_events is telemetry-only and has no document_id/message/payload.
-- Record this document event through the existing entity audit API instead.
-- Preserve the published fiscal writes, guards, grants and NFS-e event writer.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $repair_legacy_cte_poll_event$
declare
  function_oid oid := pg_catalog.to_regprocedure('public.commit_legacy_fiscal_poll_v1(jsonb)');
  definition text;
  patch record;
  original_count integer;
  corrected_count integer;
begin
  if function_oid is null or not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
    where p.oid = function_oid and p.prokind = 'f' and p.prosecdef
      and p.prorettype = 'pg_catalog.jsonb'::pg_catalog.regtype
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' and l.lanname = 'plpgsql'
  ) or pg_catalog.to_regprocedure('public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text)') is null then
    raise exception 'Legacy fiscal poll contract changed; review before repair' using errcode = '55000';
  end if;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  for patch in select * from (values
    (
      $old$v_event jsonb:=_payload->'event';$old$,
      $new$v_event jsonb:=nullif(_payload->'event','null'::jsonb);$new$
    ),
    (
      $old$insert into public.vehicle_events(tenant_id,document_id,event_type,message,payload)
      values(v_tenant,v_document,v_event->>'event_type',v_event->>'message',coalesce(v_event->'payload','{}'::jsonb));$old$,
      $new$perform public._log_entity_audit(v_tenant,'fiscal_document',v_document,v_event->>'event_type',null,
        jsonb_build_object('document_kind','cte','emission_id',v_emission,
          'message',v_event->>'message','payload',coalesce(v_event->'payload','{}'::jsonb)),
        'cte-status-poll');$new$
    )
  ) as replacements(original, corrected)
  loop
    original_count := (length(definition) - length(replace(definition, patch.original, ''))) / length(patch.original);
    corrected_count := (length(definition) - length(replace(definition, patch.corrected, ''))) / length(patch.corrected);
    if original_count = 1 and corrected_count = 0 then
      definition := replace(definition, patch.original, patch.corrected);
    elsif original_count <> 0 or corrected_count <> 1 then
      raise exception 'Legacy fiscal poll body changed; review before repair' using errcode = '55000';
    end if;
  end loop;
  execute definition;
end;
$repair_legacy_cte_poll_event$;
