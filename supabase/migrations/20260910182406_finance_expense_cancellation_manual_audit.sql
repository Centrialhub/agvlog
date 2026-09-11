-- Cancellation is a permanent manual decision, including in manual-only audit.
do $$declare definition text;needle text:='''identity_reviewed_manually'',''identity_review_reversed''';begin
 definition:=pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'finance_expense_cancel_audit_contract_changed';end if;
 execute replace(definition,needle,'''expense_cancelled'',''manual_expense_cancelled'','||needle);
end$$;
