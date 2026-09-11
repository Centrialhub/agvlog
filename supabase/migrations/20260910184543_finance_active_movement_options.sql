-- Candidate lists use active money. Linked payments, reservations and correction
-- histories remain unchanged: hiding a candidate must never erase an obligation.
do $$declare signature text;body text;needle text:='from public.finance_movements';begin
 foreach signature in array array[
  'finance_private.expense_options(uuid,text,text,uuid,integer)',
  'finance_private.manual_expense_movements(uuid,text,integer)',
  'finance_private.payable_movement_options(uuid,uuid,text,integer)',
  'finance_private.receipt_movement_options(uuid,uuid,date,text,integer)',
  'finance_private.legacy_payable_association(uuid,uuid,integer)',
  'finance_private.legacy_receivable_association(uuid,uuid,integer)',
  'finance_private.get_settlement_payment_movements(uuid,uuid,integer)',
  'finance_private.new_settlement_payment_candidates(uuid,uuid,bigint,integer)'
 ] loop
  body:=pg_get_functiondef(signature::regprocedure);
  -- Each reviewed definition has exactly one raw money selection, in its
  -- candidate set. Fail rather than silently patch a changed mixed reader.
  if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then
   raise exception 'finance_active_movement_options_contract_changed: %',signature;
  end if;
  execute replace(body,needle,'from finance_private.active_movements');
 end loop;
end$$;
