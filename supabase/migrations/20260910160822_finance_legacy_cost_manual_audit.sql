do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 needle:='''identity_reviewed_manually'',''identity_review_reversed''';
 if position(needle in body)=0 then raise exception 'finance_legacy_cost_audit_contract_changed';end if;
 execute replace(body,needle,'''legacy_expense_cost_associated'',''legacy_expense_cost_association_reversed'','||needle);
end$$;
