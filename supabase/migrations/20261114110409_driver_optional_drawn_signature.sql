set local lock_timeout='3s';set local statement_timeout='30s';
-- Explicit user request: paper receipt and receiver remain mandatory; drawing is optional.
-- Keep signatures already stored and strict ownership/hash/GPS/quality checks.
do $change$
declare item jsonb;patch jsonb;p record;definition text;needle text;
begin
 for item in select value from jsonb_array_elements($contracts$[{"signature":"public._sync_delivery_receipt_from_proof(uuid)","before":"cbf47f2cb0dd94aad3b5dfefb914e41b","after":"3b7d56ba458b6110d5bbefa01393d4a1","acl":"{postgres=X/postgres}","patches":[["  v_signature_path := coalesce(\n    nullif(v_proof.metadata->>'signature_path', ''),\n    v_proof.signature_url,\n    v_proof.storage_path\n  );","  v_signature_path := case when v_proof.metadata ? 'signature_path'\n    then nullif(v_proof.metadata->>'signature_path','')\n    else coalesce(v_proof.signature_url,v_proof.storage_path) end;"]]},{"signature":"public.driver_record_delivery_outcome_without_fiscal_gate_v1(uuid, text, jsonb, uuid, text)","before":"3078e1fa70b2b094567352e5ebc486b9","after":"a6954951efeda000f768fe8b52bc11fc","acl":"{postgres=X/postgres}","patches":[["(v_signature is null or jsonb_array_length(v_photos)=0)","jsonb_array_length(v_photos)=0"],["Foto e assinatura são obrigatórias para comprovar a entrega","O canhoto é obrigatório para comprovar a entrega"],["storage_path=v_signature,","storage_path=coalesce(v_signature,v_photos->>0),"]]},{"signature":"delivery_private.validate_driver_delivery_dispatch_evidence_v1()","before":"39bbc44b2e6cc31ab9ddbaab8311d9bd","after":"69628808b2661e3da36f414af85bf1b8","acl":"{postgres=X/postgres}","patches":[["if v_original is null or v_processed is null or v_signature is null","if v_original is null or v_processed is null"],["or v_signature not like v_prefix || 'signatures/%' then","or (v_signature is not null and v_signature not like v_prefix || 'signatures/%') then"],["or not exists(select 1 from storage.objects where bucket_id='receipts' and name=v_signature) then","or (v_signature is not null and not exists(select 1 from storage.objects where bucket_id='receipts' and name=v_signature)) then"]]}]$contracts$::jsonb) loop
  select * into p from pg_proc where oid=to_regprocedure(item->>'signature');
  if not found or md5(replace(p.prosrc,E'\r\n',E'\n'))<>item->>'before' or p.proacl::text is distinct from item->>'acl'
   or not p.prosecdef then raise exception 'optional_signature_predecessor_changed: %',item->>'signature';end if;
  definition:=replace(pg_get_functiondef(p.oid),E'\r\n',E'\n');
  for patch in select value from jsonb_array_elements(item->'patches') loop
   needle:=patch->>0;
   if length(definition)-length(replace(definition,needle,''))<>length(needle)
    then raise exception 'optional_signature_patch_changed: %',item->>'signature';end if;
   definition:=replace(definition,needle,patch->>1);
  end loop;
  execute definition;
  if not exists(select 1 from pg_proc where oid=to_regprocedure(item->>'signature')
   and md5(prosrc)=item->>'after' and proacl::text is not distinct from item->>'acl'
   and prosecdef=p.prosecdef and proconfig is not distinct from p.proconfig)
   then raise exception 'optional_signature_postcondition_failed';end if;
 end loop;
end;$change$;
notify pgrst,'reload schema';
