-- Server-paginated delivery receipt email history, including immutable attachment
-- snapshots so an operator can inspect or resend a batch independently of the
-- currently visible receipt page.
create or replace function public.list_delivery_receipt_email_batches_v1(
  _tenant_id uuid,
  _search text default null,
  _status text default null,
  _limit integer default 25,
  _offset integer default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_rows jsonb;
  v_total integer;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_email_history_not_authorized' using errcode='42501';
  end if;
  if _limit not between 1 and 100 or _offset < 0
    or length(coalesce(btrim(_search),'')) > 200
    or nullif(_status,'') is not null and _status not in('queued','sending','sent','delivered','bounced','failed') then
    raise exception 'invalid_delivery_receipt_email_history_query' using errcode='22023';
  end if;

  with filtered as (
    select batch.*
    from public.delivery_receipt_email_batches batch
    where batch.tenant_id = _tenant_id
      and (nullif(_status,'') is null or batch.status = _status)
      and (nullif(btrim(_search),'') is null
        or batch.supplier_name ilike '%'||btrim(_search)||'%'
        or batch.subject ilike '%'||btrim(_search)||'%'
        or batch.id::text ilike '%'||btrim(_search)||'%'
        or array_to_string(batch.recipients,' ') ilike '%'||btrim(_search)||'%'
        or exists (
          select 1
          from public.delivery_receipt_email_items item
          where item.batch_id = batch.id and item.tenant_id = batch.tenant_id
            and (item.file_name ilike '%'||btrim(_search)||'%'
              or item.receipt_id::text ilike '%'||btrim(_search)||'%'
              or item.document_snapshot::text ilike '%'||btrim(_search)||'%')
        ))
  ), page as (
    select * from filtered order by created_at desc,id desc limit _limit offset _offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',batch.id,
    'supplier_key',coalesce(batch.supplier_key,'name:'||left(regexp_replace(lower(btrim(batch.supplier_name)),'[^a-z0-9]+','-','g'),160)),
    'supplier_name',batch.supplier_name,
    'receipt_ids',to_jsonb(batch.receipt_ids),
    'recipients',to_jsonb(batch.recipients),
    'subject',batch.subject,
    'body_text',batch.body_text,
    'cover_config',batch.cover_config,
    'status',batch.status,
    'attempt_count',batch.attempt_count,
    'last_error',batch.last_error,
    'retry_after_at',batch.retry_after_at,
    'created_at',batch.created_at,
    'updated_at',batch.updated_at,
    'sent_at',batch.sent_at,
    'delivered_at',batch.delivered_at,
    'bounced_at',batch.bounced_at,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'receipt_id',item.receipt_id,'file_name',item.file_name,'documents',item.document_snapshot
    ) order by item.file_name,item.receipt_id)
      from public.delivery_receipt_email_items item
      where item.batch_id=batch.id and item.tenant_id=batch.tenant_id),'[]'::jsonb)
  ) order by batch.created_at desc,batch.id desc),'[]'::jsonb)
  into v_rows from page batch;

  select count(*)::integer into v_total
  from public.delivery_receipt_email_batches batch
  where batch.tenant_id = _tenant_id
    and (nullif(_status,'') is null or batch.status = _status)
    and (nullif(btrim(_search),'') is null
      or batch.supplier_name ilike '%'||btrim(_search)||'%'
      or batch.subject ilike '%'||btrim(_search)||'%'
      or batch.id::text ilike '%'||btrim(_search)||'%'
      or array_to_string(batch.recipients,' ') ilike '%'||btrim(_search)||'%'
      or exists (
        select 1 from public.delivery_receipt_email_items item
        where item.batch_id=batch.id and item.tenant_id=batch.tenant_id
          and (item.file_name ilike '%'||btrim(_search)||'%'
            or item.receipt_id::text ilike '%'||btrim(_search)||'%'
            or item.document_snapshot::text ilike '%'||btrim(_search)||'%')
      ));

  return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),
    'rows',v_rows,'total',v_total,'limit',_limit,'offset',_offset);
end;
$function$;

revoke all on function public.list_delivery_receipt_email_batches_v1(uuid,text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.list_delivery_receipt_email_batches_v1(uuid,text,text,integer,integer) to authenticated;
