create or replace function public.get_ingestion_report_index_v1(
  _tenant_id uuid,
  _from timestamptz default null,
  _to timestamptz default null,
  _batch text default null,
  _page integer default 1,
  _page_size integer default 25,
  _snapshot_at timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  result jsonb;
  effective_snapshot timestamptz := coalesce(_snapshot_at, statement_timestamp());
begin
  perform finance_private.require_access(_tenant_id);

  if _page not between 1 and 1000000
     or _page_size not between 1 and 100
     or length(coalesce(_batch,'')) > 200
     or (_from is not null and _to is not null and _from >= _to)
     or effective_snapshot > statement_timestamp() + interval '5 minutes' then
    raise exception 'invalid_ingestion_report_filters' using errcode='22023';
  end if;

  with filtered as materialized (
    select
      report.id,
      report.tenant_id,
      report.batch_id,
      report.source_label,
      report.total_docs,
      report.saved_docs,
      report.error_docs,
      report.needs_review_docs,
      report.clients_auto_created,
      report.clients_matched,
      report.clients_unresolved,
      report.created_by,
      report.created_at
    from public.ingestion_reports report
    where report.tenant_id = _tenant_id
      and report.created_at <= effective_snapshot
      and (_from is null or report.created_at >= _from)
      and (_to is null or report.created_at < _to)
      and (_batch is null or position(lower(_batch) in lower(report.batch_id)) > 0)
  ),
  totals as (
    select
      count(*)::bigint report_count,
      coalesce(sum(total_docs),0)::bigint total_docs,
      coalesce(sum(saved_docs),0)::bigint saved_docs,
      coalesce(sum(needs_review_docs),0)::bigint needs_review_docs,
      coalesce(sum(clients_auto_created),0)::bigint clients_auto_created
    from filtered
  ),
  paged as materialized (
    select *
    from filtered
    order by created_at desc, id desc
    limit _page_size offset (_page - 1) * _page_size
  )
  select jsonb_build_object(
    'tenant_id', _tenant_id,
    'snapshot_at', effective_snapshot,
    'page', _page,
    'page_size', _page_size,
    'total', totals.report_count,
    'total_docs', totals.total_docs,
    'saved_docs', totals.saved_docs,
    'needs_review_docs', totals.needs_review_docs,
    'clients_auto_created', totals.clients_auto_created,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(paged) order by paged.created_at desc, paged.id desc)
      from paged
    ), '[]'::jsonb)
  )
  into result
  from totals;

  return result;
end;
$function$;

revoke all on function public.get_ingestion_report_index_v1(
  uuid,timestamptz,timestamptz,text,integer,integer,timestamptz
) from public,anon,authenticated,service_role;
grant execute on function public.get_ingestion_report_index_v1(
  uuid,timestamptz,timestamptz,text,integer,integer,timestamptz
) to authenticated;
