DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='delivery_receipts' AND column_name='ocr_delivery_date' AND data_type='date') THEN
  RAISE EXCEPTION 'receipt date contract missing';
 END IF;
 IF has_function_privilege('authenticated','public.complete_delivery_receipt_ocr_v2(uuid,uuid,text,text,jsonb,text)','EXECUTE')
 OR has_function_privilege('anon','public.get_delivery_receipt_ocr_readings_v1(uuid,uuid[])','EXECUTE')
 OR NOT has_function_privilege('service_role','public.complete_delivery_receipt_ocr_v2(uuid,uuid,text,text,jsonb,text)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.get_delivery_receipt_ocr_readings_v1(uuid,uuid[])','EXECUTE') THEN
  RAISE EXCEPTION 'receipt RPC grants mismatch';
 END IF;
 IF (SELECT prosecdef FROM pg_proc WHERE oid='public.get_delivery_receipt_ocr_readings_v1(uuid,uuid[])'::regprocedure) THEN
  RAISE EXCEPTION 'receipt reader must preserve RLS';
 END IF;
 IF EXISTS(SELECT 1 FROM delivery_private.receipt_ocr_worker_config WHERE enabled OR worker_url IS NOT NULL) THEN
  RAISE EXCEPTION 'isolated fixture must not enable worker egress';
 END IF;
END $$;
