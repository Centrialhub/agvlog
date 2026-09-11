do $$declare body text;needle text:='''identity_reviewed_manually'',''identity_review_reversed''';begin
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 if position(needle in body)=0 then raise exception 'finance_settlement_audit_contract_changed';end if;
 execute replace(body,needle,'''settlement_payment_linked'','||needle);
end$$;
