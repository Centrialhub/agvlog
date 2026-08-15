with o as (
  select id, issue_date,
         jsonb_array_elements(coalesce(cte_payload->'payload'->'notasFiscais','[]'::jsonb)) nf
  from public.fiscal_documents
  where document_type='outbound' and status='authorized' and deleted_at is null and coalesce(is_duplicate,false)=false
), k as (
  select id as out_id, issue_date,
         regexp_replace(coalesce(nf->>'chave', nf->>'chaveAcesso', nf->>'chNFe',''),'\D','','g') nfkey
  from o
)
update public.fiscal_documents i
set cte_emitted_outbound_id = k.out_id,
    cte_emitted_at = coalesce(i.cte_emitted_at, (k.issue_date::timestamptz))
from k
where i.document_type='inbound'
  and i.deleted_at is null
  and regexp_replace(coalesce(i.access_key,''),'\D','','g') = k.nfkey
  and i.cte_emitted_outbound_id is null
  and k.nfkey <> '';