-- Physical cash has no bank/branch/account identity. Keep the original guard for
-- the actual closed account, and compare external bank identity only for noncash.
do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.guard_closed_financial_source()'::regprocedure) into body;
 needle:='where b.tenant_id=t and b.id<>(data->>''id'')::uuid and regexp_replace(coalesce(b.bank_code';
 if position(needle in body)=0 then raise exception 'finance_closed_identity_guard_contract_changed';end if;
 execute replace(body,needle,'where b.tenant_id=t and b.account_type is distinct from ''cash'' and data->>''account_type'' is distinct from ''cash'' and b.id<>(data->>''id'')::uuid and regexp_replace(coalesce(b.bank_code');
end$$;
