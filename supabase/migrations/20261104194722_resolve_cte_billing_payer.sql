-- The outbound client is the delivery recipient. Billing belongs to the
-- transport taker in the persisted CT-e snapshot, never to a name match.
create function private.resolve_cte_catalog_payer_v1() returns trigger
language plpgsql security invoker set search_path='' as $fn$
declare p jsonb; party jsonb; role_name text; role_code text; doc text; matches uuid[];
begin
 select f.cte_payload->'payload' into p from public.fiscal_documents f
 where f.id=new.id and f.tenant_id=new.tenant_id and f.document_type='outbound'
 and exists(select 1 from public.hub_fiscal_emissions e where e.tenant_id=f.tenant_id
  and e.fiscal_document_id=f.id and e.doc_type='cte');
 -- Preserve legacy catalogs without a Hub snapshot and all existing charges.
 if p is null or not (p ? 'tomador') then return new; end if;
 if new.receivable_id is not null
  or exists(select 1 from public.receivables r where r.tenant_id=new.tenant_id and r.cte_document_id=new.id)
  or exists(select 1 from public.client_invoice_charges c where c.tenant_id=new.tenant_id
   and c.source_type='cte_document' and c.source_id=new.id) then
  if tg_op='UPDATE' then new.client_id:=old.client_id; end if;
  return new;
 end if;
 role_name:=p#>>'{tomador,role}'; role_code:=p#>>'{tomador,tipo}';
 if role_name is null then
  role_name:=case role_code when '0' then 'remetente' when '1' then 'expedidor'
   when '2' then 'recebedor' when '3' then 'destinatario' when '4' then 'terceiro' end;
 end if;
 if role_code is not null and role_code is distinct from (case role_name
  when 'remetente' then '0' when 'expedidor' then '1' when 'recebedor' then '2'
  when 'destinatario' then '3' when 'terceiro' then '4' end) then
  role_name:=null;
 end if;
 party:=case when role_name='terceiro' then p->'tomador'
  when role_name in('remetente','expedidor','recebedor','destinatario') then p->role_name end;
 doc:=regexp_replace(coalesce(party->>'cnpj',party->>'cpf',''),'[^0-9]','','g');
 if length(doc) in(11,14) then
  select array_agg(c.id order by c.id) into matches from public.clients c
  where c.tenant_id=new.tenant_id and c.active
   and regexp_replace(coalesce(c.tax_id,''),'[^0-9]','','g')=doc;
 end if;
 -- Missing/ambiguous identity cannot silently charge the recipient instead.
 new.client_id:=case when cardinality(matches)=1 then matches[1] else null end;
 new.payer_cnpj:=nullif(doc,''); new.payer_name:=party->>'nome';
 return new;
end;$fn$;
revoke all on function private.resolve_cte_catalog_payer_v1() from public,anon,authenticated,service_role;
create trigger cte_catalog_payer_v1 before insert or update of client_id on public.cte_documents
for each row execute function private.resolve_cte_catalog_payer_v1();

-- Only unbilled catalogs are repaired. No fiscal snapshot, invoice or
-- receivable is rewritten. The trigger repeats the protection under row lock.
update public.cte_documents d set client_id=d.client_id
where d.receivable_id is null and d.status='authorized' and d.sefaz_environment='production'
 and d.cancelled_at is null and not d.is_voided
 and exists(select 1 from public.fiscal_documents f where f.id=d.id and f.tenant_id=d.tenant_id
  and f.document_type='outbound' and f.cte_payload->'payload' ? 'tomador')
 and not exists(select 1 from public.receivables r where r.tenant_id=d.tenant_id and r.cte_document_id=d.id)
 and not exists(select 1 from public.client_invoice_charges c where c.tenant_id=d.tenant_id
  and c.source_type='cte_document' and c.source_id=d.id);
