-- Keep the old action name for durable replays. New reversals must explicitly
-- declare a real return of money; allocation correction has its own command.
do $$declare body text;needle text;begin
 select pg_get_functiondef('public.apply_receivable_financial_command(jsonb)'::regprocedure) into body;
 needle:='''attachment_path'',''payment_id''';
 if position(needle in body)=0 then raise exception 'finance_refund_payload_contract_changed';end if;
 body:=replace(body,needle,needle||',''refund_kind''');
 needle:=' perform public._lock_receivable_financial_graph(v_tenant,v_id);';
 if position(needle in body)=0 then raise exception 'finance_refund_command_contract_changed';end if;
 body:=replace(body,needle,E' if (v_action=''reverse'' and _payload->>''refund_kind'' is distinct from ''money_returned'') or (v_action<>''reverse'' and _payload ? ''refund_kind'') then raise exception ''financial_refund_confirmation_required'' using errcode=''23514'';end if;\n'||needle);
 needle:=' insert into public.receivable_financial_commands(id,tenant_id,actor_id,request_id,receivable_id,action,reason,payload_hash,before_snapshot,after_snapshot,response)';
 if position(needle in body)=0 then raise exception 'finance_refund_result_contract_changed';end if;
 body:=replace(body,needle,E' if v_action=''reverse'' then v_result:=v_result||jsonb_build_object(''refund_kind'',''money_returned'');end if;\n'||needle);
 execute body;
end;$$;
