do $patch$
declare body text;
begin
  body:=pg_get_functiondef('public.read_product_history_v1(uuid,text,date,date)'::regprocedure);
  if position('from public.current_load_items item' in body)=0 then
    if position('from public.load_items item' in body)=0 then
      raise exception 'product_history_item_source_changed';
    end if;
    body:=replace(body,'from public.load_items item','from public.current_load_items item');
  end if;
  if position('from public.current_dispatch_stop_documents link' in body)=0 then
    if position('from public.dispatch_stop_documents link' in body)=0 then
      raise exception 'product_history_stop_source_changed';
    end if;
    body:=replace(body,'from public.dispatch_stop_documents link','from public.current_dispatch_stop_documents link');
  end if;
  execute body;
end
$patch$;

alter function public.read_product_history_v1(uuid,text,date,date) security definer;
alter function public.read_product_history_v1(uuid,text,date,date) set search_path='';

do $patch$
declare body text;needle text;
begin
  body:=pg_get_functiondef('public.create_checklist_execution_v1(uuid,uuid,jsonb,uuid,uuid,uuid,text)'::regprocedure);
  if position('checklist_requires_confirmed_verification' in body)>0 then return;end if;
  needle:=$old$  v_status := case when v_failed = 0 then 'passed' when v_passed = 0 then 'failed' else 'partial' end;$old$;
  if position(needle in body)=0 then raise exception 'checklist_status_calculation_changed';end if;
  body:=replace(body,needle,$new$  if v_passed = 0 and v_failed = 0 then
    raise exception 'checklist_requires_confirmed_verification' using errcode = '23514';
  end if;
  v_status := case when v_failed = 0 then 'passed' when v_passed = 0 then 'failed' else 'partial' end;$new$);
  execute body;
end
$patch$;

revoke all on function public.read_product_history_v1(uuid,text,date,date),
  public.create_checklist_execution_v1(uuid,uuid,jsonb,uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.read_product_history_v1(uuid,text,date,date),
  public.create_checklist_execution_v1(uuid,uuid,jsonb,uuid,uuid,uuid,text)
  to authenticated,service_role;
