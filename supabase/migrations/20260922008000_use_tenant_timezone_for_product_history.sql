do $migration$
declare v_definition text;v_replaced text;
begin
  select pg_get_functiondef('public.read_product_history_v1(uuid,text,date,date)'::regprocedure) into v_definition;
  v_replaced:=replace(v_definition,'''America/Sao_Paulo''','v_timezone');
  if v_replaced=v_definition then raise exception 'product_history_timezone_anchor_not_found';end if;
  v_replaced:=replace(v_replaced,'  v_result jsonb;',
    '  v_result jsonb;'||chr(10)||'  v_timezone text := coalesce((select tenant.timezone from public.tenants tenant where tenant.id=_tenant_id),''America/Sao_Paulo'');');
  if position('v_timezone text' in v_replaced)=0 then raise exception 'product_history_declaration_anchor_not_found';end if;
  execute v_replaced;
end;
$migration$;

comment on function public.read_product_history_v1(uuid,text,date,date) is
'Histórico de produto filtrado e agrupado pela data civil do timezone configurado no tenant.';
