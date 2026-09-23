create or replace function public.validate_doccob_content_v1(
  _tenant_id uuid,_invoice_ids uuid[],_content text,_record_count integer
) returns void language plpgsql stable security definer set search_path='' as $function$
declare v_lines text[];v_line text;v_actual integer;v_type text;v_expected_length integer;
 v_352 integer:=0;v_353 integer:=0;v_354 integer:=0;v_invoice record;v_detail record;v_parsed integer;v_parsed_sum numeric;
begin
  if _content is null or octet_length(_content)>5000000 then raise exception 'doccob_content_invalid' using errcode='22023';end if;
  v_lines:=string_to_array(replace(_content,E'\r\n',E'\n'),E'\n');
  while cardinality(v_lines)>0 and v_lines[cardinality(v_lines)]='' loop v_lines:=v_lines[1:cardinality(v_lines)-1];end loop;
  v_actual:=cardinality(v_lines);
  if v_actual is distinct from _record_count or v_actual<5 then raise exception 'doccob_record_count_mismatch' using errcode='40001';end if;
  if left(v_lines[1],3)<>'000' or left(v_lines[2],3)<>'350' or left(v_lines[3],3)<>'351' or left(v_lines[v_actual],3)<>'355' then
    raise exception 'doccob_record_sequence_invalid' using errcode='22023';end if;
  foreach v_line in array v_lines loop
    v_type:=left(v_line,3);
    v_expected_length:=case v_type when '000' then 120 when '350' then 60 when '351' then 120 when '352' then 180 when '353' then 200 when '354' then 180 when '355' then 60 else null end;
    if v_expected_length is null or char_length(v_line)<>v_expected_length then raise exception 'doccob_record_invalid:%',v_type using errcode='22023';end if;
    if v_type='352' then v_352:=v_352+1;elsif v_type='353' then v_353:=v_353+1;elsif v_type='354' then v_354:=v_354+1;end if;
  end loop;
  if v_352<>cardinality(_invoice_ids)
    or v_353<>(select count(*) from public.client_invoice_charges where tenant_id=_tenant_id and invoice_id=any(_invoice_ids) and cancelled_at is null)
    or v_354<>(select count(*) from public.client_invoice_details where tenant_id=_tenant_id and invoice_id=any(_invoice_ids)) then
    raise exception 'doccob_record_types_mismatch' using errcode='40001';end if;
  if btrim(substring(v_lines[v_actual] from 4 for 6))::integer<>cardinality(_invoice_ids)
    or btrim(substring(v_lines[v_actual] from 10 for 15))::numeric<>(select round(coalesce(sum(total_amount),0)*100) from public.client_invoices where tenant_id=_tenant_id and id=any(_invoice_ids))
    or btrim(substring(v_lines[v_actual] from 25 for 6))::integer<>v_actual then
    raise exception 'doccob_trailer_mismatch' using errcode='40001';end if;
  for v_invoice in
    select grouped.*,
      (select count(*) from public.client_invoice_charges charge where charge.tenant_id=_tenant_id and charge.invoice_id=any(grouped.ids) and charge.cancelled_at is null)::integer charge_count,
      (select round(coalesce(sum(charge.gross_amount),0)*100) from public.client_invoice_charges charge where charge.tenant_id=_tenant_id and charge.invoice_id=any(grouped.ids) and charge.cancelled_at is null) charge_cents
    from(select invoice_number,round(total_amount*100)::numeric amount_cents,count(*)::integer copies,array_agg(id) ids
      from public.client_invoices where tenant_id=_tenant_id and id=any(_invoice_ids) group by invoice_number,round(total_amount*100)) grouped
  loop
    select count(*) into v_parsed from unnest(v_lines) line where left(line,3)='352'
      and btrim(substring(line from 19 for 20))=v_invoice.invoice_number
      and btrim(substring(line from 55 for 15))::numeric=v_invoice.amount_cents;
    if v_parsed<>v_invoice.copies then raise exception 'doccob_invoice_line_mismatch:%',v_invoice.invoice_number using errcode='40001';end if;
    select count(*),coalesce(sum(btrim(substring(line from 72 for 15))::numeric),0) into v_parsed,v_parsed_sum
      from unnest(v_lines) line where left(line,3)='353' and btrim(substring(line from 101 for 20))=v_invoice.invoice_number;
    if v_parsed<>v_invoice.charge_count or v_parsed_sum<>v_invoice.charge_cents then raise exception 'doccob_charge_lines_mismatch:%',v_invoice.invoice_number using errcode='40001';end if;
  end loop;
  for v_detail in
    select coalesce(detail.document_number,'' ) document_number,round(coalesce(detail.cargo_value,0)*100)::numeric cargo_cents,
      coalesce(charge.source_number,'') source_number,count(*)::integer copies
    from public.client_invoice_details detail join public.client_invoice_charges charge on charge.tenant_id=detail.tenant_id and charge.id=detail.charge_id
    where detail.tenant_id=_tenant_id and detail.invoice_id=any(_invoice_ids) and charge.cancelled_at is null
    group by coalesce(detail.document_number,''),round(coalesce(detail.cargo_value,0)*100),coalesce(charge.source_number,'')
  loop
    select count(*) into v_parsed from unnest(v_lines) line where left(line,3)='354'
      and btrim(substring(line from 4 for 20))=v_detail.document_number
      and btrim(substring(line from 32 for 15))::numeric=v_detail.cargo_cents
      and btrim(substring(line from 59 for 20))=v_detail.source_number;
    if v_parsed<>v_detail.copies then raise exception 'doccob_detail_lines_mismatch:%',v_detail.document_number using errcode='40001';end if;
  end loop;
end;
$function$;

do $migration$
declare v_definition text;v_marker text:='  -- Valida faturas';
begin
  select pg_get_functiondef('public.register_doccob_export(uuid,uuid,uuid,uuid[],text,date,text,text,integer,numeric,integer,integer,text)'::regprocedure) into v_definition;
  if position('validate_doccob_content_v1' in v_definition)>0 then return;end if;
  if position(v_marker in v_definition)=0 then raise exception 'doccob_register_validation_anchor_not_found';end if;
  execute replace(v_definition,v_marker,'  perform public.validate_doccob_content_v1(_tenant_id,_client_invoice_ids,_generated_content,_record_count);'||chr(10)||chr(10)||v_marker);
end;
$migration$;

revoke all on function public.validate_doccob_content_v1(uuid,uuid[],text,integer) from public,anon,authenticated,service_role;
