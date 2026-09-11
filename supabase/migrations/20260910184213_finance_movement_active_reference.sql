-- Only duplicate-reference eligibility changes. The immutable original command
-- and its result remain the source of replay, even after its movement is voided.
do $$declare body text;original text;lock_statement text;begin
 body:=pg_get_functiondef('finance_private.record_movement(jsonb)'::regprocedure);
 original:=$old$select 1 from public.finance_movements where tenant_id=t and bank_account_id=account
   and bank_reference=btrim(_payload->>'bank_reference')$old$;
 if position(original in body)=0 then raise exception 'finance_active_reference_contract_changed';end if;
 body:=replace(body,original,replace(original,'public.finance_movements','finance_private.active_movements'));
 lock_statement:='perform pg_advisory_xact_lock(hashtextextended(t::text||'':finance'',0));';
 if position(lock_statement in body)=0 then raise exception 'finance_active_reference_lock_contract_changed';end if;
 body:=replace(body,lock_statement,lock_statement||E'\n if not finance_private.can_access(t) then raise exception ''finance_access_denied'' using errcode=''42501'';end if;');
 execute body;
end;$$;
