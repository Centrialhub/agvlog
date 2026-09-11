-- Preserve visibility in the existing manual-only filter, including reversals.
do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 needle:='''identity_reviewed_manually'',''identity_review_reversed''';
 if position(needle in body)=0 then raise exception 'finance_period_manual_audit_contract_changed';end if;
 execute replace(body,needle,'''account_period_closed'',''account_period_reopened'',''legacy_cut_reviewed'',''closed_period_composition_recorded'','||needle);
end$$;
