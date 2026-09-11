-- Current operational obligations, never historical as-of or bank cash.
create function finance_private.payable_portfolio_evidence(_tenant uuid,_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.payables%rowtype;pp record;m public.finance_movements%rowtype;b public.bank_transactions%rowtype;l public.finance_payable_movement_links%rowtype;
 issues text[]:='{}';paid numeric:=0;used numeric;links integer;refs jsonb:='[]';snap jsonb;valid boolean;active boolean;
begin
 select * into p from public.payables where tenant_id=_tenant and id=_id;
 if p.id is null then return jsonb_build_object('valid',false,'issues',jsonb_build_array('title_missing'));end if;
 if p.status is null or p.status<>all(array['pending','approved','partial','paid','overdue','cancelled']) then issues:=array_append(issues,'unknown_status');end if;
 if not coalesce(p.amount>=0 and p.amount*100=trunc(p.amount*100) and p.amount*100<=99999999999999,false) then issues:=array_append(issues,'invalid_amount');end if;
 if not coalesce(p.paid_amount>=0 and p.paid_amount*100=trunc(p.paid_amount*100) and p.paid_amount*100<=99999999999999,false) then issues:=array_append(issues,'invalid_declared_paid');end if;
 if p.created_at is null or not isfinite(p.created_at) then issues:=array_append(issues,'invalid_created_at');end if;
 if p.due_date is not null and not isfinite(p.due_date) then issues:=array_append(issues,'invalid_due_date');end if;
 for pp in select x.*,exists(select 1 from finance_private.active_payable_payments a where a.tenant_id=_tenant and a.id=x.id) active
 from public.payables_payments x where x.tenant_id=_tenant and x.payable_id=p.id order by x.id loop
 if pp.active then
 if not coalesce(pp.amount>0 and pp.amount*100=trunc(pp.amount*100) and pp.amount*100<=99999999999999,false) then issues:=array_append(issues,'invalid_payment_amount');else paid:=paid+pp.amount;end if;
 select count(*) into links from public.finance_payable_movement_links x where x.tenant_id=_tenant and x.payment_id=pp.id and not exists(select 1 from public.finance_payable_link_reversals r where r.tenant_id=_tenant and r.link_id=x.id);
 select * into l from public.finance_payable_movement_links x where x.tenant_id=_tenant and x.payment_id=pp.id and not exists(select 1 from public.finance_payable_link_reversals r where r.tenant_id=_tenant and r.link_id=x.id) order by x.id limit 1;
 select * into m from public.finance_movements where tenant_id=_tenant and id=l.movement_id;
 used:=case when m.id is not null then finance_private.movement_used_cents(_tenant,m.id) end;
 if not coalesce(links=1 and l.payable_id=p.id and l.amount_cents=pp.amount*100 and m.direction='out' and m.nature<>'transfer'
 and m.bank_account_id=pp.bank_account_id and (p.driver_id is null or m.driver_id=p.driver_id) and isfinite(pp.paid_at)
 and m.occurred_on=(pp.paid_at at time zone 'America/Sao_Paulo')::date and used>=pp.amount*100 and used<=m.amount_cents
 and exists(select 1 from public.bank_accounts a where a.tenant_id=_tenant and a.id=m.bank_account_id),false) then issues:=array_append(issues,'payment_money_chain_unresolved');end if;
 if pp.bank_transaction_id is not null then
 select * into b from public.bank_transactions where tenant_id=_tenant and id=pp.bank_transaction_id;
 if not coalesce(b.id is not null and b.bank_account_id=pp.bank_account_id and b.transaction_type='debit' and abs(b.amount)=pp.amount and isfinite(b.posted_at) and (b.posted_at at time zone 'America/Sao_Paulo')::date=m.occurred_on,false) then issues:=array_append(issues,'payment_bank_projection_mismatch');end if;
 end if;
 refs:=refs||jsonb_build_array(jsonb_build_object('payment_id',pp.id,'link_id',l.id,'movement_id',m.id,'account_id',m.bank_account_id,'occurred_on',case when isfinite(m.occurred_on) then m.occurred_on end,'used_cents',used::text,'movement',to_jsonb(m),'bank_transaction',case when pp.bank_transaction_id is not null then to_jsonb(b) end));
 end if;
 end loop;
 if exists(select 1 from public.finance_payable_movement_links x where x.tenant_id=_tenant and x.payable_id=p.id and not exists(select 1 from public.finance_payable_link_reversals r where r.tenant_id=_tenant and r.link_id=x.id) and not exists(select 1 from finance_private.active_payable_payments ap where ap.tenant_id=_tenant and ap.id=x.payment_id and ap.payable_id=p.id)) then issues:=array_append(issues,'orphan_payment_link');end if;
 if paid is distinct from p.paid_amount then issues:=array_append(issues,'declared_paid_mismatch');end if;
 if paid>p.amount then issues:=array_append(issues,'overpaid');end if;
 if p.status='paid' and paid is distinct from p.amount then issues:=array_append(issues,'paid_without_full_payment');end if;
 if p.status='partial' and not(paid>0 and paid<p.amount) then issues:=array_append(issues,'partial_status_mismatch');end if;
 if p.status in('pending','approved','overdue') and paid>0 then issues:=array_append(issues,'unpaid_status_with_payment');end if;
 if p.status='cancelled' and paid<>0 then issues:=array_append(issues,'cancelled_with_active_payment');end if;
 select coalesce(array_agg(distinct x order by x),'{}') into issues from unnest(issues)x;
 valid:=cardinality(issues)=0;active:=p.status is distinct from 'cancelled';
 snap:=jsonb_build_object('title',to_jsonb(p),'payments',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.payables_payments x where x.tenant_id=_tenant and x.payable_id=p.id),
 'links',(select coalesce(jsonb_agg(jsonb_build_object('link',to_jsonb(x),'reversals',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from public.finance_payable_link_reversals r where r.tenant_id=_tenant and r.link_id=x.id)) order by x.id),'[]') from public.finance_payable_movement_links x where x.tenant_id=_tenant and (x.payable_id=p.id or exists(select 1 from public.payables_payments xp where xp.tenant_id=_tenant and xp.payable_id=p.id and xp.id=x.payment_id))), 'money',refs);
 return jsonb_build_object('valid',valid,'issues',to_jsonb(issues),'revision',md5(snap::text),'payment_ids',(select coalesce(jsonb_agg(x.id order by x.id),'[]') from finance_private.active_payable_payments x where x.tenant_id=_tenant and x.payable_id=p.id),
 'nominal_cents',case when valid then (case when active then trunc(p.amount*100) else 0 end)::text end,
 'paid_cents',case when valid then (case when active then trunc(paid*100) else 0 end)::text end,
 'open_cents',case when valid then (case when active then trunc((p.amount-paid)*100) else 0 end)::text end);
end$$;
revoke all on function finance_private.payable_portfolio_evidence(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.payable_portfolio(_tenant uuid,_filters jsonb,_page integer,_revision text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare basis text;starts date;ends date;supplier uuid;filter_category text;today date:=(statement_timestamp() at time zone 'America/Sao_Paulo')::date;result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_filters) is distinct from 'object' or _page is null or _page not between 1 and 1000000 or exists(select 1 from jsonb_each(_filters) f where f.key<>all(array['date_basis','from','to','category','supplier_id']) or jsonb_typeof(f.value) not in('string','null')) then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if exists(select 1 from jsonb_each_text(_filters) f where f.key in('from','to') and f.value is not null and f.value !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 basis:=coalesce(_filters->>'date_basis','due_date');starts:=nullif(_filters->>'from','')::date;ends:=nullif(_filters->>'to','')::date;supplier:=nullif(_filters->>'supplier_id','')::uuid;filter_category:=nullif(btrim(_filters->>'category'),'');
 if basis<>all(array['due_date','created_at']) or starts>ends or (starts is not null and not isfinite(starts)) or (ends is not null and not isfinite(ends)) or length(filter_category)>100 or (_revision is not null and _revision !~ '^[a-f0-9]{32}$') then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 with selected as materialized(
 select p.*,case when basis='due_date' then case when isfinite(p.due_date) then p.due_date end else case when isfinite(p.created_at) then (p.created_at at time zone 'America/Sao_Paulo')::date end end filter_day
 from public.payables p where p.tenant_id=_tenant and (supplier is null or p.supplier_id=supplier) and (filter_category is null or p.category=filter_category)
 ), scoped as materialized(select * from selected where filter_day is null or ((starts is null or filter_day>=starts) and (ends is null or filter_day<=ends))),
 evidence as materialized(select p.*,finance_private.payable_portfolio_evidence(_tenant,p.id) ev from scoped p),
 rows as materialized(select id,coalesce(status,'unknown') status,filter_day,
 jsonb_build_object('source_table','payables','source_id',id,'status',coalesce(status,'unknown'),'supplier_id',supplier_id,'supplier_name',supplier_name,'category',category,'description',description,
 'due_on',case when isfinite(due_date) then due_date end,'created_on',case when isfinite(created_at) then (created_at at time zone 'America/Sao_Paulo')::date end,
 'date_in_range',filter_day is not null,'origin',jsonb_build_object('source_table',source_table,'source_id',source_id),'declared_amount',amount::text,'declared_paid',paid_amount::text,
 'payment_ids',ev->'payment_ids','valid',ev->'valid','issues',ev->'issues','nominal_cents',ev->'nominal_cents','paid_cents',ev->'paid_cents','open_cents',ev->'open_cents','source_revision',ev->'revision') value,
 (ev->>'valid')::boolean valid,(ev->>'nominal_cents')::numeric nominal,(ev->>'paid_cents')::numeric paid,(ev->>'open_cents')::numeric remaining,
 case when isfinite(due_date) then due_date end due_on from evidence),
 summary as(select count(*) total,count(*) filter(where status='cancelled') cancelled,count(*) filter(where not valid) invalid,count(*) filter(where filter_day is null) undated,
 coalesce(sum(nominal),0) nominal,coalesce(sum(paid),0) paid,coalesce(sum(remaining),0) remaining,coalesce(sum(remaining) filter(where due_on<today),0) overdue from rows),
 fingerprint as(select md5(jsonb_build_object('tenant',_tenant,'filters',jsonb_build_object('date_basis',basis,'from',starts,'to',ends,'category',filter_category,'supplier_id',supplier),'day',today,'sources',coalesce(jsonb_agg(value order by id),'[]'))::text) revision from rows),
 paged as(select value,filter_day,id from rows order by filter_day nulls last,id limit 30 offset (_page-1)*30),
 grouped as(select status,count(*) count from rows group by status),issues as(select issue,count(*) count from rows cross join lateral jsonb_array_elements_text(value->'issues')issue group by issue)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'basis','current_operational','date_basis',basis,'from',starts,'to',ends,'category',filter_category,'supplier_id',supplier,'as_of',today,
 'revision',f.revision,'page',_page,'page_size',30,'total_titles',s.total,'cancelled_titles',s.cancelled,'invalid_titles',s.invalid,'undated_titles',s.undated,'totals_valid',s.invalid=0,
 'nominal_cents',case when s.invalid=0 then s.nominal::text end,'paid_cents',case when s.invalid=0 then s.paid::text end,'open_cents',case when s.invalid=0 then s.remaining::text end,'overdue_cents',case when s.invalid=0 then s.overdue::text end,
 'status_counts',coalesce((select jsonb_agg(to_jsonb(g) order by status) from grouped g),'[]'),'issue_counts',coalesce((select jsonb_agg(to_jsonb(g) order by issue) from issues g),'[]'),
 'rows',coalesce((select jsonb_agg(value order by filter_day nulls last,id) from paged),'[]')) into result from summary s cross join fingerprint f;
 if _revision is not null and result->>'revision'<>_revision then raise exception 'finance_payable_portfolio_changed' using errcode='40001';end if;
 return result;
end$$;
revoke all on function finance_private.payable_portfolio(uuid,jsonb,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.payable_portfolio(uuid,jsonb,integer,text) to authenticated;
create function public.get_finance_payable_portfolio(_tenant_id uuid,_filters jsonb default '{}',_page integer default 1,_revision text default null) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.payable_portfolio(_tenant_id,_filters,_page,_revision)$$;
revoke all on function public.get_finance_payable_portfolio(uuid,jsonb,integer,text) from public,anon,service_role;
grant execute on function public.get_finance_payable_portfolio(uuid,jsonb,integer,text) to authenticated;
