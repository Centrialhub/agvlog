-- Preflight fiscal SOMENTE LEITURA. Não lê tokens, ciphertext, dados pessoais ou documentos.
-- Executar no projeto explicitamente conferido antes de qualquer publicação; guardar resultado redigido.
select jsonb_build_object(
 'checked_at',clock_timestamp(),
 'contracts',(select jsonb_agg(jsonb_build_object('signature',s,'present',to_regprocedure(s) is not null))
   from unnest(array[
    'public.prepare_cte_issue(uuid,uuid,text,uuid[],jsonb)',
    'public.claim_hub_fiscal_emission(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,uuid)',
    'public.complete_hub_fiscal_emission(uuid,uuid,jsonb,integer)',
    'public.filter_billable_fiscal_sources(uuid,text,uuid[])',
    'public._client_invoice_draft_snapshot(uuid,jsonb,boolean,uuid)',
    'public.apply_client_invoice_command(jsonb)',
    'public.apply_receivable_financial_command(jsonb)',
    'public.apply_closing_report_action(jsonb)']) s),
 'emitters',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'tenant_id',e.tenant_id,
   'cte_homologation',exists(select 1 from public.hub_fiscal_credentials c where c.tenant_id=e.tenant_id and c.emitter_id=e.id and c.enabled and c.environment='homologation' and c.doc_scope in('all','cte')),
   'nfse_homologation',exists(select 1 from public.hub_fiscal_credentials c where c.tenant_id=e.tenant_id and c.emitter_id=e.id and c.enabled and c.environment='homologation' and c.doc_scope in('all','nfse')))), '[]'::jsonb)
   from public.tenant_emitters e where e.active),
 'policies',(select jsonb_agg(jsonb_build_object('tenant_id',tenant_id,'feature',feature_key,'enabled',enabled))
   from public.tenant_feature_policy where feature_key in('fiscal_enabled','fiscal_kill_switch'))
) as readiness;
