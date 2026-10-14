-- Local isolated rehearsal recipe for reviewed42 + MFA/caller-JWT contract.
-- Input catalog318f SHA256 bf09e91b7a2a5a9eb7d6c8e34f37f20b222f26096f1bd66e6d7ebaa7c2a4c4aa; new helper bodyMD5 763e82a37b0b6cb4554ba2aa28c07e53.
-- Preserve all data/Storage/not_performed/uncertain requests; no helper body restoration.
-- Stop submissions and drain in-flight uploads before executing in an explicitly coordinated environment.
-- This is containment/resumption of current endpoints, not restoration of a pre-MFA API.
BEGIN;
SET LOCAL search_path=pg_catalog,public;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
DO $reviewed_expense_release$
DECLARE c record;p pg_catalog.pg_proc%ROWTYPE;target oid;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtext('driver-expense-release'),1) THEN
  RAISE EXCEPTION 'expense_creation_release_active_requests' USING ERRCODE='55000';
 END IF;
 IF NOT coalesce((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.driver_expense_creations')),false)
  OR has_table_privilege('authenticated','public.driver_expense_creations','insert,update,delete') THEN
  RAISE EXCEPTION 'Expense release refused: audit table changed';
 END IF;
 FOR c IN SELECT * FROM (VALUES
  ('expense_creation_private.create_driver_expense_command(jsonb)','ee9a1da2cfbe0471152c8698a798aa4c','postgres',true,'v','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('expense_creation_private.get_expense_creation_context(uuid,text,uuid)','a52f0195201784bca398588bee6beb53','postgres',true,'v','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('expense_creation_private.get_expense_receipt_status(uuid,uuid,text,uuid,jsonb)','49d3bea5248bc7d70ae3833f96d9e093','postgres',true,'s','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('expense_creation_private.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb)','66ecfbe64b43dc1f54effa1e5401a6c9','postgres',true,'v','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('expense_creation_private.list_driver_expense_sources(uuid,integer)','7cb4b43e6948c4b78993362e77afc8a9','postgres',true,'s','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('expense_creation_private.list_driver_expenses(uuid,integer)','850d36077559b49ba11553e315e20346','postgres',true,'s','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('expense_creation_private.owns_driver(uuid,uuid)','c7e95c6a4b7dfbe9f857d201a0d96ec1','postgres',true,'s','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('expense_creation_private.owns_receipt(text)','fdd658daeff6223889449555ead277b8','postgres',true,'s','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('expense_creation_private.recalculate_manual_expense_settlement(uuid,uuid)','5448532b22737549b48e2bff6634a60e','postgres',true,'v','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('expense_creation_private.require_operational_access(uuid,text)','2f7bf841aa7d0760d8e204153174dbe4','postgres',false,'s','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('expense_creation_private.require_session(uuid,uuid)','5fd92b35b9bc7d0637d66daefe005108','postgres',false,'s','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('expense_creation_private.session_allowed(uuid)','1a7ab2b56f39fd0eb4ebbff204a07720','postgres',true,'s','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public._build_manual_driver_settlement(uuid)','8797dda84f56510ebf4b7b99b095c106','postgres',false,'v','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('public._check_expense_creation_ack()','dbb6bbc9b374c46ede5c3c4c08829789','postgres',true,'v','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('public._expense_creation_source(uuid,uuid,text,uuid)','13a493b368da71ef02021fdf1365a11e','postgres',false,'s','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('public._expense_receipt_descriptor(uuid,uuid,uuid,jsonb)','3afdd20fb9ebce7863b72dd4c43a8fa7','postgres',false,'i','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('public._expense_receipt_status(uuid,uuid,uuid,text,uuid,jsonb)','763e82a37b0b6cb4554ba2aa28c07e53','postgres',false,'s','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('public._expense_review_snapshot(uuid,uuid)','3dae734b95ddb3f40d3953f5613a4bf6','postgres',false,'s','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('public._guard_expense_creation_contract()','96186c8c4136fbf40f90b22bad07b9df','postgres',true,'v','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('public._guard_expense_creation_release()','291807b6b324778c388654e629f43f8d','postgres',false,'v','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('public._preserve_driver_expense_command()','0e1be5733a3feef5111263e9cae91882','postgres',false,'v','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('public._tg_mark_outdated_expense()','4fe2453ada9862a50d9512ea5a62bb6f','postgres',true,'v','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('public.associate_finance_legacy_expense_cost(jsonb)','b1a03d8dd83d851f47cbce68ab34b8de','postgres',false,'v','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.attach_finance_expense_receipt_artifact(jsonb)','5a59beddef0df768d5b5e993ede3c47f','postgres',false,'v','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.cancel_finance_expense(jsonb)','c3098d6732c32de6d3f0025c5838b48d','postgres',false,'v','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.cancel_finance_manual_expense(jsonb)','5e293ae42fc8f2d85f02e0a05d73c80b','postgres',false,'v','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.create_driver_expense_command(jsonb)','55d17f0322a521183a1faf66df7555d9','postgres',false,'v','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('public.get_expense_creation_context(uuid,text,uuid)','f1258010a1eef808edced6c5f06cdca5','postgres',false,'v','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.get_finance_expense_options(uuid,text,text,uuid,integer)','ba02157f59bb1c60e344858a593936b4','postgres',false,'v','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.get_finance_expense_receipt_artifacts(uuid,uuid)','5ac22017d4bc80e43813eb846393ec01','postgres',false,'v','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.get_finance_legacy_expense_cost_context(uuid,uuid,integer)','9e2d5e7c65fcbde1b8e400e5226fd0d5','postgres',false,'s','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.get_finance_manual_expense_movements(uuid,text,integer)','88cee8ddb92b03562ad748d481efa7bd','postgres',false,'s','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.get_finance_settlement_expense_context(uuid,uuid,integer)','105a917d2780591f8cd6928aaf0dd4d5','postgres',false,'s','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.get_finance_settlement_expense_context_v2(uuid,uuid,integer,text)','c67012ff786f09e5a1decfb563c02c68','postgres',false,'s','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb)','61d7ee970359b177191ac615f3a83b9e','postgres',false,'v','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('public.list_finance_expense_page_v2(uuid,jsonb)','0b9334c3566bcd42dae36a57cafedc31','postgres',false,'s','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.list_finance_expenses(uuid,jsonb)','086a3d80c948b3129abb936e13c41ff0','postgres',false,'v','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.prepare_finance_expense_receipt_intent(jsonb)','84933b6f965fee8fe9e671fce6f5338e','postgres',false,'v','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.preview_finance_expense_cancellation(uuid,uuid)','8774029e9e5692c4ec342f2af04b83a8','postgres',false,'s','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.preview_finance_manual_expense_cancellation(uuid,uuid)','e71d0a92b876e24f46a471dad5f97e38','postgres',false,'s','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.recalculate_manual_expense_settlement(uuid,uuid)','c575298e4167f836cf57c2b6b58696f3','postgres',false,'v','["search_path=\"\""]'::jsonb,false,false,'{postgres=X/postgres}'),
  ('public.record_finance_expense_batch(jsonb)','522e121a020a4dd08bfa5ed29c809a05','postgres',false,'v','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.record_finance_manual_expense(jsonb)','e728f0d203225d94f6e090f7b2caeb70','postgres',false,'v','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.reverse_finance_legacy_expense_cost_association(jsonb)','6933cbcf67d36fc8ec32a12a598ae8c6','postgres',false,'v','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.review_driver_expense(jsonb)','663be971e8b52b95f78a718c7148e330','postgres',true,'v','["search_path=\"\""]'::jsonb,true,false,'{postgres=X/postgres,authenticated=X/postgres}')
 ) expected(signature,body_hash,owner,definer,volatility,settings,authenticated_grant,service_grant,acl) LOOP
  target:=to_regprocedure(c.signature);SELECT * INTO p FROM pg_proc WHERE oid=target;
  IF target IS NULL OR md5(replace(p.prosrc,E'\r\n',E'\n')) IS DISTINCT FROM c.body_hash
   OR pg_get_userbyid(p.proowner) IS DISTINCT FROM c.owner OR p.prosecdef IS DISTINCT FROM c.definer
   OR p.provolatile::text IS DISTINCT FROM c.volatility OR to_jsonb(p.proconfig) IS DISTINCT FROM c.settings
   OR p.proacl::text IS DISTINCT FROM c.acl OR has_function_privilege('anon',target,'execute')
   OR has_function_privilege('authenticated',target,'execute') IS DISTINCT FROM c.authenticated_grant
   OR has_function_privilege('service_role',target,'execute') IS DISTINCT FROM c.service_grant THEN
   RAISE EXCEPTION 'Expense release refused: current MFA function or grants changed %',c.signature;
  END IF;
  IF NOT pg_has_role(current_user,p.proowner,'USAGE') THEN RAISE EXCEPTION 'Expense release requires function owner' USING ERRCODE='42501';END IF;
 END LOOP;
 FOR c IN SELECT * FROM (VALUES
  ('check_expense_creation_ack','public.driver_expenses','O','22c8afb5e73c90b0b753693c2aad97a5ea838638bcef457abf34eef89798c44a'),
  ('check_expense_review_ack','public.driver_expenses','O','46c5f918a93618d176298317fe2f8deb109c3e3b3ec899173ae3b81db71e2c63'),
  ('driver_settlement_requires_closed_cargo_v1','public.driver_settlements','O','9de3d141b8225679ca3b61a8d5f47ae88d3f8f2dac950843843abf7fd8c4268a'),
  ('driver_settlement_status_requires_cargo_release_v1','public.driver_settlements','O','aaf6b3a69acf2dcaf71458e589d85daad6163e874b3d4eda761f1611dd87175c'),
  ('expense_creations_append_only','public.driver_expense_creations','O','8593ca2ce0a338aa2bf5487ec9974b0ac0c1d2ca9b67a43cbd464f8da42e008a'),
  ('finance_preserve_associated_driver_expense','public.driver_expenses','O','4073e56b2bf0f91744090f8c8f425aa73442cf48e512261dc0027204fac9b77a'),
  ('guard_audited_trip_cancellation','public.driver_expenses','O','3ccffa2f3c161c350b5d67d78dd10b0109e57ee50803abac7a5aa0080220a158'),
  ('guard_audited_trip_cancellation','public.driver_settlements','O','22b132ecfb1893ac0ed2a32935474893f21e768f783c7b3fd1dcb16eba8fdb1b'),
  ('guard_delivery_correction_finalization','public.driver_settlements','O','e688e7e177df9d64762bbdef2895ab48a63d0018ccddac179a50e9f144859639'),
  ('guard_expense_creation_contract','public.driver_expenses','O','c6a41b0ef66f5bdd91e225d5fa7d4611b28220e51e638541d897005b58fbeaf1'),
  ('guard_expense_review_contract','public.driver_expenses','O','c7d5f50a1bab265cdc3ad4ab2e020a4429c04d8790df125eb1081e70b5818b17'),
  ('guard_materialized_trip_correction','public.driver_expenses','O','dbbd2d24c4621a2da64178307a7617bbb4c4d7c04c2fbc057039b54391848152'),
  ('guard_materialized_trip_correction','public.driver_settlements','O','7dcb3e0caf171c4d20ee215c263f4964f6d739e4b9c7a12b8e2e1375b7113ec5'),
  ('invalidate_legacy_integrity_cache','public.driver_settlements','O','a78861ca3cf80e1f941fb6446b498def81a2628d386cc076ed154c38598c4822'),
  ('trg_driver_expenses_outdate','public.driver_expenses','O','b4cb4ff06e6a69df18ebe62aac9e6dc0723aa6f5575a15d9160945d28f9b6af0'),
  ('trg_driver_settlements_touch','public.driver_settlements','O','186e3fad8b9ca05eac5fe20e3abbbd74217c30e253506386195ce10d2ecaefcf'),
  ('trg_sync_obligations_from_expense','public.driver_expenses','O','2c84d17f89c35c14fe17bdff4f98bb8ee195547ac36901f60357e88065f23289'),
  ('trg_sync_obligations_from_settlement','public.driver_settlements','O','b4f00536b93ae53d9cec4a02e4be264b12c1a8e66b1b29d905289ffb6a7c9ce7')
 ) expected(name,relation,enabled,hash) LOOP
  IF (SELECT count(*) FROM pg_trigger WHERE tgname=c.name AND tgrelid=to_regclass(c.relation) AND tgenabled::text=c.enabled
   AND encode(sha256(convert_to(pg_get_triggerdef(oid),'UTF8')),'hex')=c.hash)<>1 THEN
   RAISE EXCEPTION 'Expense release refused: current integrity trigger changed %',c.name;
  END IF;
 END LOOP;
 FOR c IN SELECT * FROM (VALUES
  ('check_expense_creation_ack','public.driver_expenses',true,'698fc09045e7267eeb19c5b09473ec8c40f237145be8c1cbd97b9dde2451ddc1'),
  ('check_expense_review_ack','public.driver_expenses',true,'698fc09045e7267eeb19c5b09473ec8c40f237145be8c1cbd97b9dde2451ddc1'),
  ('driver_expense_creations_pkey','public.driver_expense_creations',true,'8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5'),
  ('driver_expense_creations_source_type_check','public.driver_expense_creations',true,'b6f0a1d6b28cbd88b12ef80ad0d530ce76596351d19ff08f100d3283f7cad0c2'),
  ('driver_expense_creations_tenant_id_actor_id_request_id_key','public.driver_expense_creations',true,'62a4af2325bcac876f4a95f9b26d6030ad3a4ff46c34e685fde5bd2712012c81'),
  ('driver_expense_creations_tenant_id_expense_id_fkey','public.driver_expense_creations',true,'cd753b73b1f937a576533a38dd0b83805b1a38aba0b963029f827a3da79ca18d'),
  ('driver_expense_creations_tenant_id_id_key','public.driver_expense_creations',true,'df85201802c68cde29d160aa847142747ee29b47a7699f4a3b0d143b054cad73'),
  ('driver_expenses_dispatch_trip_id_fkey','public.driver_expenses',true,'2f670d62e70e22e88ba679630762f9ff029ce926c7781c15bc394b26235ad6e4'),
  ('driver_expenses_driver_id_fkey','public.driver_expenses',true,'ee63f5e0c73878b98b273b16c007950ce671c3149da57d7a2b2ba7a1ef746392'),
  ('driver_expenses_pkey','public.driver_expenses',true,'8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5'),
  ('driver_expenses_tenant_id_fkey','public.driver_expenses',true,'d931da577fc120910fe105fe12727c52721a31800b4baf73445d56de61900526'),
  ('driver_settlement_km_values_valid','public.driver_settlements',false,'b5361d1fa70cbf72293e01428d7fc1b8f27b543055b0a13a3fed3598303fd0a6'),
  ('driver_settlements_dispatch_trip_id_fkey','public.driver_settlements',true,'a95826865794b20e0c7b0f5d04f436c3bc338cfba0a40daf6f1ad336fca36b3d'),
  ('driver_settlements_driver_id_fkey','public.driver_settlements',true,'ee63f5e0c73878b98b273b16c007950ce671c3149da57d7a2b2ba7a1ef746392'),
  ('driver_settlements_km_status_chk','public.driver_settlements',true,'667e981a989bf5984d66a29bad9a4b060590fd5b03e0e68c0484ed9e819b7bde'),
  ('driver_settlements_pkey','public.driver_settlements',true,'8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5'),
  ('driver_settlements_status_chk','public.driver_settlements',true,'bba5de48e10ce8f31dddb332646ad396b15dff20f995dca55159e296149638f6'),
  ('driver_settlements_tenant_id_fkey','public.driver_settlements',true,'1e19dbe9a1ee81b75100767d8e99893a34b475a2d9f3a98b1c4820630d000e96'),
  ('driver_settlements_trip_unique','public.driver_settlements',true,'57de419d9dee463eb601bc3cfa767a2d8e7ae0fc0ffd255455962cc352336d12'),
  ('driver_settlements_vehicle_id_fkey','public.driver_settlements',true,'1ccc0110afed8192d982a15bb7995e8fbc1333a87e6de1fe8987cfa5dc1b2a19'),
  ('expense_creation_command_fkey','public.driver_expenses',true,'62b3edac9bd96061f6bbc50e31cc588e1616cec96a10fc72adfd4aadd580aa38'),
  ('expense_manual_settlement_scope_fkey','public.driver_expenses',true,'cedfb9326e487b2b3fabd0963f03c7ce84619c6de856573f10a71174ed012890'),
  ('expense_review_command_fkey','public.driver_expenses',true,'35adb4c9c5b94379f3d30af7384bebb0670414ac119a3c3b60f0261258c0001d'),
  ('expense_single_origin','public.driver_expenses',true,'74ce89b24f7dc30a6cd91825ee6cee66d08dcc3033626d22a97f807d5c635c11')
 ) expected(name,relation,validated,hash) LOOP
  IF (SELECT count(*) FROM pg_constraint WHERE conname=c.name AND conrelid=to_regclass(c.relation) AND convalidated=c.validated
   AND encode(sha256(convert_to(pg_get_constraintdef(oid),'UTF8')),'hex')=c.hash)<>1 THEN
   RAISE EXCEPTION 'Expense release refused: current integrity constraint changed %',c.name;
  END IF;
 END LOOP;
END;
$reviewed_expense_release$;
 GRANT EXECUTE ON FUNCTION expense_creation_private.create_driver_expense_command(jsonb) TO authenticated;
 GRANT EXECUTE ON FUNCTION expense_creation_private.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb) TO authenticated;
 GRANT EXECUTE ON FUNCTION expense_creation_private.recalculate_manual_expense_settlement(uuid,uuid) TO authenticated;
 GRANT EXECUTE ON FUNCTION public.create_driver_expense_command(jsonb) TO authenticated;
 GRANT EXECUTE ON FUNCTION public.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb) TO authenticated;
 GRANT EXECUTE ON FUNCTION public.recalculate_manual_expense_settlement(uuid,uuid) TO authenticated;
COMMIT;
