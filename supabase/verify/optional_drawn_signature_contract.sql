begin;
set local statement_timeout='30s';
do $guard$ begin
 if (select count(*) from auth.users)<>7 or (select count(*) from auth.users where email like '%@agvlog-e2e.invalid')<>7 then raise exception 'isolated_seed_required';end if;
end;$guard$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","active_tenant_id":"20000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers','{"x-agvlog-tenant-id":"20000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
do $start$ declare t constant uuid:='80000000-0000-4000-8000-000000000001';payload jsonb;begin
 perform public.driver_save_checklist(t,'pre','{"schema_version":2,"checklist_model":"vehicle_readiness_v1","checked_items":[0,1,2,3,4,5],"total_items":6,"answers":[true,true,true,true,true,true],"expected_checklist_id":null,"expected_boundary_id":null}'::jsonb);
 perform public.driver_update_trip_cargo_v1('20000000-0000-4000-8000-000000000001',t,gen_random_uuid(),'accept','{"vehicle_id":"50000000-0000-4000-8000-000000000001"}'::jsonb);
 select jsonb_build_object('confirm_all_documents',true,'expected_updated_at',updated_at) into payload from public.trip_cargo_controls where dispatch_trip_id=t;
 perform public.driver_update_trip_cargo_v1('20000000-0000-4000-8000-000000000001',t,gen_random_uuid(),'quick_confirm',payload);
 perform public.driver_update_trip_cargo_v1('20000000-0000-4000-8000-000000000001',t,gen_random_uuid(),'mark_departed','{}'::jsonb);
 perform public.driver_start_trip(t);
 perform public.driver_mark_arrival('82000000-0000-4000-8000-000000000001',-15.802,-43.313,8);
end;$start$;
reset role;
insert into storage.buckets(id,name,public) values('receipts','receipts',false) on conflict(id) do nothing;
insert into storage.objects(bucket_id,name) values
 ('receipts','20000000-0000-4000-8000-000000000001/deliveries/80000000-0000-4000-8000-000000000001/82000000-0000-4000-8000-000000000001/receipt/original/synthetic.jpg'),
 ('receipts','20000000-0000-4000-8000-000000000001/deliveries/80000000-0000-4000-8000-000000000001/82000000-0000-4000-8000-000000000001/receipt/processed/synthetic.jpg');
set local role authenticated;
do $delivery$
declare tenant constant uuid:='20000000-0000-4000-8000-000000000001';trip constant uuid:='80000000-0000-4000-8000-000000000001';
 stop constant uuid:='82000000-0000-4000-8000-000000000001';prefix text;details jsonb;request uuid:=gen_random_uuid();result jsonb;again jsonb;
begin
 prefix:=tenant::text||'/deliveries/'||trip::text||'/'||stop::text||'/receipt/';
 details:=jsonb_build_object('receiver_name','Recebedor sintetico sem assinatura desenhada','notes','Entrega de fixture revisada',
 'signature_path',null,'photo_paths',jsonb_build_array(prefix||'processed/synthetic.jpg'),
 'receipt_original_path',prefix||'original/synthetic.jpg','receipt_processed_path',prefix||'processed/synthetic.jpg',
 'receipt_original_hash',repeat('a',64),'receipt_processed_hash',repeat('b',64),'receipt_scan_mode','document_scan',
 'receipt_scan_quality',jsonb_build_object('accepted',true,'requiresConfirmation',false,'sourceWidth',2400,'sourceHeight',3200,
 'processedWidth',1900,'processedHeight',2800,'brightness',180,'contrast',40,'sharpness',12,'glareRatio',0.01,'edgeCutRisk',false,
 'estimatedDpi',422,'processingMs',100,'warnings','[]'::jsonb,'rejectionReasons','[]'::jsonb),
 'receipt_quality_confirmed',true,'latitude',-15.802,'longitude',-43.313,'accuracy_m',8,'captured_at',clock_timestamp(),
 'fiscal_snapshot',public.get_driver_delivery_fiscal_snapshot_v1(tenant,trip,stop));
 result:=public.driver_record_delivery_outcome(stop,'delivered',details,request,'arrived');
 if result->'conflict'='true'::jsonb or result->>'event_id' is null then raise exception 'signatureless_delivery_not_recorded';end if;
 again:=public.driver_record_delivery_outcome(stop,'delivered',details,request,'arrived');
 if again->'replayed' is distinct from 'true'::jsonb or again->>'event_id'<>result->>'event_id' then raise exception 'signatureless_delivery_replay_failed';end if;
end;$delivery$;
reset role;
do $verify$ begin
 if not exists(select 1 from public.delivery_receipts where dispatch_stop_id='82000000-0000-4000-8000-000000000001'
  and signature_path is null and original_path like '%/receipt/original/synthetic.jpg' and processed_path like '%/receipt/processed/synthetic.jpg')
 then raise exception 'signatureless_receipt_missing_or_fabricated_signature';end if;
 if exists(select 1 from storage.objects where name like '%/signatures/%') then raise exception 'unexpected_drawn_signature';end if;
end;$verify$;
rollback;
