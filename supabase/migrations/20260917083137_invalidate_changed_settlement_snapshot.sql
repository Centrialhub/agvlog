do $patch$
declare body text;needle text;
begin
 body:=pg_get_functiondef('public.list_driver_settlements_v2(uuid,text,uuid,uuid,text,date,date,boolean,boolean,boolean,boolean,timestamptz,jsonb,integer)'::regprocedure);

 needle:=$old$  v_cursor_id uuid;
  v_total integer;$old$;
 if position(needle in body)=0 then raise exception 'settlement_snapshot_patch_variables_changed';end if;
 body:=replace(body,needle,$new$  v_cursor_id uuid;
  v_cursor_revision text;
  v_total integer;
  v_revision text;$new$);

 needle:=$old$      v_cursor_id := (_cursor ->> 'id')::uuid;
      if v_cursor_created is null or v_cursor_id is null then$old$;
 if position(needle in body)=0 then raise exception 'settlement_snapshot_patch_cursor_changed';end if;
 body:=replace(body,needle,$new$      v_cursor_id := (_cursor ->> 'id')::uuid;
      v_cursor_revision := _cursor ->> 'revision';
      if v_cursor_revision is null or v_cursor_revision !~ '^[a-f0-9]{32}$' then
        raise exception 'settlement_cursor_invalid' using errcode = '22023';
      end if;
      if v_cursor_created is null or v_cursor_id is null then$new$);

 needle:=$old$      coalesce(sum(approved_expenses_total), 0) as approved_expenses_total
    from base$old$;
 if position(needle in body)=0 then raise exception 'settlement_snapshot_patch_totals_changed';end if;
 body:=replace(body,needle,$new$      coalesce(sum(approved_expenses_total), 0) as approved_expenses_total,
      md5(coalesce(string_agg(md5(to_jsonb(base)::text), '' order by base.id), 'empty')) as revision
    from base$new$);

 needle:=$old$    totals.total_count,
    coalesce(($old$;
 if position(needle in body)=0 then raise exception 'settlement_snapshot_patch_select_changed';end if;
 body:=replace(body,needle,$new$    totals.total_count,
    totals.revision,
    coalesce(($new$);

 needle:=$old$    to_jsonb(totals),$old$;
 if position(needle in body)=0 then raise exception 'settlement_snapshot_patch_summary_changed';end if;
 body:=replace(body,needle,$new$    to_jsonb(totals) - 'revision',$new$);

 needle:=$old$        'scope', v_scope,
        'trip_completed_at'$old$;
 if position(needle in body)=0 then raise exception 'settlement_snapshot_patch_next_changed';end if;
 body:=replace(body,needle,$new$        'scope', v_scope,
        'revision', totals.revision,
        'trip_completed_at'$new$);

 needle:=$old$  into v_total, v_items, v_summary, v_next
  from totals;

  return jsonb_build_object($old$;
 if position(needle in body)=0 then raise exception 'settlement_snapshot_patch_result_changed';end if;
 body:=replace(body,needle,$new$  into v_total, v_revision, v_items, v_summary, v_next
  from totals;

  if _cursor is not null and v_cursor_revision is distinct from v_revision then
    raise exception 'settlement_snapshot_changed' using errcode = '40001';
  end if;

  return jsonb_build_object($new$);

 needle:=$old$    'snapshot_at', v_snapshot,
    'items', v_items,$old$;
 if position(needle in body)=0 then raise exception 'settlement_snapshot_patch_response_changed';end if;
 body:=replace(body,needle,$new$    'snapshot_at', v_snapshot,
    'revision', v_revision,
    'items', v_items,$new$);

 execute body;
end
$patch$;
