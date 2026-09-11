-- A service worker may wait behind another financial command. Its originating
-- user must still be eligible when the lock is acquired, including on replay.
do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.record_statement_verification(jsonb)'::regprocedure) into body;
 needle:=$needle$perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));$needle$;
 if position(needle in body)=0 or position('existing.action<>''verify_statement_source''' in body)=0 then
  raise exception 'finance_statement_verification_contract_changed';
 end if;
 execute replace(body,needle,needle||$patch$
 -- Revalidate the originating actor after waiting; service_role has no user UID.
 if actor is null or not exists(select 1 from public.tenant_memberships m where m.tenant_id=t and m.user_id=actor and m.active and m.role::text in('owner','admin','operator'))
   or exists(select 1 from public.tenant_memberships m where m.tenant_id=t and m.user_id=actor and m.active and m.role::text='driver')
   or exists(select 1 from public.drivers d where d.tenant_id=t and d.user_id=actor and d.active) then
   raise exception 'finance_access_denied' using errcode='42501';
 end if;
$patch$);
end$$;
