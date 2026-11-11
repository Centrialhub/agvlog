-- Synthetic isolated database only; no job, delivery or external request created.
begin;
set local statement_timeout='15s';
do $guard$
begin
 if (select count(*) from auth.users)<>7 or
    (select count(*) from auth.users where email like '%@agvlog-e2e.invalid')<>7 then raise exception 'isolated_seed_required';end if;
 if exists(select 1 from delivery_private.receipt_ocr_worker_config where enabled or worker_url is not null) then raise exception 'worker_egress_enabled';end if;
 if has_function_privilege('authenticated','public.complete_delivery_receipt_ocr_v2(uuid,uuid,text,text,jsonb,text)','execute')
  or has_function_privilege('anon','public.complete_delivery_receipt_ocr_v2(uuid,uuid,text,text,jsonb,text)','execute') then raise exception 'client_ocr_writer_exposed';end if;
end;$guard$;
set local role service_role;
do $provider_validation$
declare provider text;payload jsonb;
begin
 foreach provider in array array['lovable','openai','unknown'] loop
  payload:=jsonb_build_object('text','Synthetic receipt','date_text','09/11/2026','delivery_date','2026-11-09',
   'date_confidence',0.95,'signature_presence','present','signature_confidence',0.96,'needs_review',false,'provider',provider,'model','gpt-6-luna');
  begin
   perform public.complete_delivery_receipt_ocr_v2('00000000-0000-4000-8000-000000000000',
    '00000000-0000-4000-8000-000000000000',repeat('b',64),'completed',payload,null);
   raise exception 'missing_job_was_accepted';
  exception when others then
   if sqlerrm<>(case when provider='unknown' then 'invalid_delivery_receipt_ocr_result' else 'delivery_receipt_ocr_job_not_found' end) then raise;end if;
  end;
 end loop;
end;$provider_validation$;
rollback;
