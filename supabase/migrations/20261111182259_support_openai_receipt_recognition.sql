-- Add only OpenAI provenance; preserve leases, hashes, tenant guards and review.
do $openai_receipt_provider$
declare body text;old_clause text:=$old$_result->>'provider' is distinct from 'lovable'$old$;
 new_clause text:=$new$coalesce(_result->>'provider','') not in('lovable','openai')$new$;
begin
 body:=pg_get_functiondef('public.complete_delivery_receipt_ocr_v2(uuid,uuid,text,text,jsonb,text)'::regprocedure);
 if position(new_clause in body)>0 then return;end if;
 if (length(body)-length(replace(body,old_clause,'')))<>length(old_clause) then
  raise exception 'receipt_ocr_provider_contract_changed';
 end if;
 execute replace(body,old_clause,new_clause);
end;$openai_receipt_provider$;
