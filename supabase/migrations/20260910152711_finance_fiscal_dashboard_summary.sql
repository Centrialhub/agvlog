-- Current state of fiscal receivable projections, never a bank cash balance.
create function finance_private.fiscal_dashboard_summary(_tenant uuid,_from date,_to date,_client uuid,_kind text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if (_from is not null and not isfinite(_from)) or (_to is not null and not isfinite(_to)) or _from>_to or _kind is null or _kind not in('all','cte','nfse') then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if _client is not null and not exists(select 1 from public.clients where tenant_id=_tenant and id=_client) then raise exception 'finance_client_not_found' using errcode='22023';end if;
 with selected as materialized(
  select o.*,r.amount,r.status title_status,r.client_id,
   case when o.basis->>'amount_cents' ~ '^[0-9]{1,14}$' then (o.basis->>'amount_cents')::numeric end net,
   case when o.basis->>'gross_cents' ~ '^[0-9]{1,14}$' then (o.basis->>'gross_cents')::numeric end gross,
   case when o.basis->>'withheld_cents' ~ '^[0-9]{1,14}$' then (o.basis->>'withheld_cents')::numeric end withheld,
   r.id is not null has_title,
   coalesce(snap.snapshot->>'request_payload_hash','')=md5(coalesce(e.request_payload,'{}')::text)
    and e.doc_type=o.doc_type and snap.emission_id=o.emission_id
    and o.source_id=(case when o.doc_type='nfse' then e.nfse_document_id else coalesce(e.fiscal_document_id,e.cte_document_id) end)
    and o.fiscal_identity=(case when o.doc_type='cte' then e.access_key else nullif(e.hub_document_id,'') end)
    and not exists(select 1 from unnest(array['doc_type','environment','status','dispatch_state','hub_document_id','id_integracao','emitter_cnpj','access_key','authorization_protocol','number','series','cte_document_id','fiscal_document_id','nfse_document_id','provider_document_version','provider_effect_id','provider_occurred_at']) key
     where coalesce(snap.snapshot->key,'null'::jsonb) is distinct from coalesce(to_jsonb(e)->key,'null'::jsonb)) observation_current
  from public.finance_fiscal_receivable_origins o
  left join public.receivables r on r.tenant_id=o.tenant_id and r.id=o.receivable_id
  left join public.hub_fiscal_emissions e on e.tenant_id=o.tenant_id and e.id=o.emission_id
  left join public.finance_fiscal_observations snap on snap.tenant_id=o.tenant_id and snap.id=o.observation_id
  where o.tenant_id=_tenant and (_kind='all' or o.doc_type=_kind) and (_client is null or r.client_id=_client)
   and (o.created_at is null or not isfinite(o.created_at) or
    ((_from is null or o.created_at>=(_from::timestamp at time zone 'America/Sao_Paulo'))
     and (_to is null or o.created_at<((_to+1)::timestamp at time zone 'America/Sao_Paulo'))))
 ), checked as materialized(
  select s.*,coalesce(has_title and observation_current and basis->'ready'='true'::jsonb and basis->>'payer_id'=client_id::text and title_status<>'cancelled' and created_at is not null and isfinite(created_at)
   and net>0 and gross>=net and withheld>=0 and gross=net+withheld and net=amount*100
   and finance_private.receivable_fiscal_issue(_tenant,receivable_id) is null,false) valid
  from selected s
 ), totals as(
  select count(*) total,count(*) filter(where state='active') active,
   count(*) filter(where state='cancelled') cancelled,count(*) filter(where state not in('active','cancelled')) review,
   count(*) filter(where state='active' and not valid) invalid,
   coalesce(sum(net) filter(where state='active' and valid),0) net,
   coalesce(sum(gross) filter(where state='active' and valid),0) gross,
   coalesce(sum(withheld) filter(where state='active' and valid),0) withheld from checked
 ), kinds as(
  select doc_type,count(*) filter(where state='active') active,
   coalesce(sum(net) filter(where state='active' and valid),0) net from checked group by doc_type
 ), months as(
  select to_char(created_at at time zone 'America/Sao_Paulo','YYYY-MM') as month_key,
   sum(net) net from checked where state='active' and valid group by 1
 )
 select jsonb_build_object('version',1,'tenant_id',_tenant,'from',_from,'to',_to,'client_id',_client,'doc_type',_kind,
  'basis','fiscal_receivable_origins','date_basis','incorporated_at','total_count',t.total,'active_count',t.active,
  'cancelled_count',t.cancelled,'review_count',t.review,'invalid_count',t.invalid,'totals_valid',t.invalid=0,
  'net_cents',case when t.invalid=0 then t.net::text end,'gross_cents',case when t.invalid=0 then t.gross::text end,
  'withheld_cents',case when t.invalid=0 then t.withheld::text end,
  'kinds',coalesce((select jsonb_agg(jsonb_build_object('doc_type',k.doc_type,'active_count',k.active,'net_cents',case when t.invalid=0 then k.net::text end) order by k.doc_type) from kinds k),'[]'),
  'months',coalesce((select jsonb_agg(jsonb_build_object('month',m.month_key,'net_cents',case when t.invalid=0 then m.net::text end) order by m.month_key) from months m),'[]'),
  'pending_jobs',(select count(*) from public.finance_fiscal_projection_jobs j where j.tenant_id=_tenant and j.status in('pending','review')),
  'pending_jobs_scope','tenant_all_dates') into result from totals t;
 return result;
end$$;
revoke all on function finance_private.fiscal_dashboard_summary(uuid,date,date,uuid,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.fiscal_dashboard_summary(uuid,date,date,uuid,text) to authenticated;
create function public.get_finance_fiscal_dashboard_summary(_tenant_id uuid,_from date default null,_to date default null,_client_id uuid default null,_doc_type text default 'all')
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.fiscal_dashboard_summary(_tenant_id,_from,_to,_client_id,_doc_type)$$;
revoke all on function public.get_finance_fiscal_dashboard_summary(uuid,date,date,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_fiscal_dashboard_summary(uuid,date,date,uuid,text) to authenticated;
