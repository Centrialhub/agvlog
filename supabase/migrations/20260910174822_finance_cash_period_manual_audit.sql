-- Cash evidence is a manual declaration and must remain visible in manual-only audit.
do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 needle:='''identity_reviewed_manually'',''identity_review_reversed''';
 if position(needle in body)=0 then raise exception 'finance_cash_manual_audit_contract_changed';end if;
 execute replace(body,needle,'''cash_period_count_recorded'',''cash_period_count_reversed'',''cash_period_closed'','||needle);
end$$;
