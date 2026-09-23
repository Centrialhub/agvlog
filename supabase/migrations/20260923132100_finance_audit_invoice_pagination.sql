create or replace function finance_private.invoice_financial_page(_tenant uuid,_filters jsonb,_page integer,_revision text)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare result jsonb; today date:=(statement_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
 perform finance_private.require_access(_tenant);
 if jsonb_typeof(_filters) is distinct from 'object' or _page is null or _page not between 1 and 1000000
 or exists(select 1 from jsonb_each(_filters) f where f.key not in('search','status','client') or jsonb_typeof(f.value)<>'string')
 or length(coalesce(_filters->>'search',''))>200
 or coalesce(_filters->>'status','all') not in('all','draft','generated','sent','paid','cancelled') then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 with selected as materialized(
  select inv.* from public.client_invoices inv left join public.clients cl on cl.id=inv.client_id and cl.tenant_id=inv.tenant_id
  where inv.tenant_id=_tenant and (coalesce(_filters->>'status','all')='all' or inv.status=_filters->>'status')
   and (coalesce(_filters->>'client','all')='all' or inv.client_id=(_filters->>'client')::uuid)
   and (coalesce(_filters->>'search','')='' or strpos(lower(concat_ws(' ',inv.invoice_number,cl.company_name)),lower(_filters->>'search'))>0)
 ), ledger as materialized (
  select inv.id invoice_id,e.* from selected inv
  cross join lateral public._receivable_ledger_evidence(_tenant,inv.receivable_id) e
 ), checked as materialized(select inv.*,to_jsonb(client)-'tenant_id' client_json,e.net,coalesce(
   r.id is not null and r.client_invoice_id=inv.id and r.client_id=inv.client_id and r.amount=inv.total_amount and inv.total_amount>0
   and e.valid and e.net between 0 and r.amount and coalesce(r.received_amount,0)=e.net
   and not exists(select 1 from public.receivables other where other.tenant_id=_tenant and other.client_invoice_id=inv.id and other.id<>r.id)
   and (case when inv.status='cancelled' then r.status='cancelled' and e.net=0 else
     r.status=(case when e.net>=r.amount then 'received' when e.net>0 then 'partial' else 'invoiced' end)
     and inv.status=(case when e.net>=r.amount then 'paid' when inv.sent_at is not null then 'sent' else 'generated' end) end)
   and not exists(select 1 from public.client_invoice_charges ch where ch.tenant_id=_tenant and ch.invoice_id=inv.id and (ch.cancelled_at is null)<>(inv.status<>'cancelled'))
   and (select count(*)<=1 from public.closing_reports c where c.tenant_id=_tenant and (c.client_invoice_id=inv.id or c.receivable_id=r.id))
   and not exists(select 1 from public.closing_reports c where c.tenant_id=_tenant and (c.client_invoice_id=inv.id or c.receivable_id=r.id) and not coalesce(
     c.client_invoice_id=inv.id and c.receivable_id=r.id and c.client_id=inv.client_id and c.total_amount=r.amount and c.received_amount=e.net
     and c.open_amount=(case when inv.status='cancelled' then 0 else r.amount-e.net end)
     and (case when inv.status='cancelled' then c.status='cancelled' and c.invoice_status='cancelled' and c.payment_status='unpaid'
       and not exists(select 1 from public.closing_report_charge_claims claim where claim.tenant_id=_tenant and claim.report_id=c.id and claim.released_at is null)
       else c.status=(case when c.status='overdue' and c.expected_payment_date<current_date and e.net<r.amount then 'overdue' when e.net>=r.amount then 'paid' when e.net>0 then 'partially_paid' else 'invoiced' end)
       and c.payment_status=(case when c.status='overdue' then 'overdue' when e.net>=r.amount then 'paid' when e.net>0 then 'partially_paid' else 'unpaid' end) end),false)),false) consistent
  from selected inv
  left join public.receivables r on r.tenant_id=_tenant and r.id=inv.receivable_id
  left join lateral(select cl.company_name,cl.tax_id from public.clients cl where cl.tenant_id=_tenant and cl.id=inv.client_id) client on true
  join ledger e on e.invoice_id=inv.id),
 projected as materialized(
  select id,created_at,status,due_date,consistent,net,total_amount,
   (to_jsonb(c)-'client_json'-'net'-'consistent')||jsonb_build_object('clients',c.client_json,
   'received_amount',case when consistent then net else null end,
   'open_amount',case when consistent then case when status='cancelled' then 0 else total_amount-net end else null end,
   'requires_reconciliation',not consistent) value from checked c
 ), fingerprint as(select md5(jsonb_build_object('filters',_filters,'today',today,'rows',coalesce(jsonb_agg(value order by id),'[]'))::text) revision from projected),
 summary as(select count(*) total,count(*) filter(where not consistent) invalid,
  coalesce(sum((total_amount-net)*100) filter(where status in('generated','sent')),0)::numeric open,
  coalesce(sum((total_amount-net)*100) filter(where status in('generated','sent') and due_date<today),0)::numeric overdue,
  coalesce(sum((total_amount-net)*100) filter(where status='sent'),0)::numeric sent,
  coalesce(sum(net*100) filter(where status<>'cancelled'),0)::numeric paid from projected),
 paged as(select * from projected order by created_at desc,id limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',2,'tenant_id',_tenant,'actor_id',auth.uid(),'page',_page,'page_size',30,
  'total',s.total,'invalid_count',s.invalid,'filters',_filters,'revision',f.revision,'truncated',false,
  'totals',jsonb_build_object('open',case when s.invalid=0 then trunc(s.open)::text end,'overdue',case when s.invalid=0 then trunc(s.overdue)::text end,
   'sent',case when s.invalid=0 then trunc(s.sent)::text end,'paid',case when s.invalid=0 then trunc(s.paid)::text end),
  'rows',coalesce((select jsonb_agg(value order by created_at desc,id) from paged),'[]')) into result from summary s cross join fingerprint f;
 if _revision is not null and result->>'revision' is distinct from _revision then raise exception 'finance_invoice_list_changed' using errcode='40001';end if;
 return result;
end;$function$;
revoke all on function finance_private.invoice_financial_page(uuid,jsonb,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.invoice_financial_page(uuid,jsonb,integer,text) to authenticated;
create or replace function public.list_client_invoice_financial_page(_tenant_id uuid,_filters jsonb,_page integer default 1,_revision text default null)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.invoice_financial_page(_tenant_id,_filters,_page,_revision)$$;
revoke all on function public.list_client_invoice_financial_page(uuid,jsonb,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.list_client_invoice_financial_page(uuid,jsonb,integer,text) to authenticated;
notify pgrst,'reload schema';
