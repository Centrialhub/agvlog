-- Captured origin compatibility is separate from financial ledger reconciliation.
create function finance_private.unloading_receivable_source_context(_tenant uuid,_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c public.finance_unloading_charges%rowtype; r public.receivables%rowtype; proof jsonb; mismatch boolean;
begin
 select * into c from public.finance_unloading_charges where tenant_id=_tenant and receivable_id=_id;
 if not found then return jsonb_build_object('source_issue',null,'source_revision',null); end if;
 select * into r from public.receivables where tenant_id=_tenant and id=_id;
 mismatch:=r.id is null or r.client_id is distinct from c.supplier_id or r.amount is null
   or r.amount::text in ('NaN','Infinity','-Infinity') or r.amount*100 is distinct from c.amount_cents::numeric
   or r.client_invoice_id is not null or r.closing_report_id is not null
   or to_jsonb(r)->>'fiscal_document_id' is not null or to_jsonb(r)->>'cte_document_id' is not null
   or r.status in ('cancelled','invoiced');
 proof:=jsonb_build_object('charge',to_jsonb(c),'receivable',jsonb_build_object(
  'id',r.id,'tenant_id',r.tenant_id,'client_id',r.client_id,'amount',r.amount,
  'client_invoice_id',r.client_invoice_id,'closing_report_id',r.closing_report_id,
  'fiscal_document_id',to_jsonb(r)->'fiscal_document_id','cte_document_id',to_jsonb(r)->'cte_document_id','status',r.status));
 return jsonb_build_object('source_issue',case when mismatch then 'finance_unloading_source_mismatch' end,
  'source_revision',md5(proof::text));
end $$;
revoke all on function finance_private.unloading_receivable_source_context(uuid,uuid) from public,anon,authenticated,service_role;

do $patch$
declare body text; needle text:='return v_result||jsonb_build_object(''revision'',md5(v_result::text));';
begin
 body:=pg_get_functiondef('public._receivable_financial_snapshot(uuid,uuid)'::regprocedure);
 if position(needle in body)=0 then raise exception 'unloading_context_contract_changed'; end if;
 body:=replace(body,needle,$new$
 v_result:=v_result||finance_private.unloading_receivable_source_context(_tenant,_id);
 if v_result->>'source_issue' is not null then v_result:=v_result||jsonb_build_object('can_receive',false); end if;
 return v_result||jsonb_build_object('revision',md5(v_result::text));$new$);
 execute body;
end $patch$;
