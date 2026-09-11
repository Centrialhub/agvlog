-- Reject the proven ManagerSaaS integration-batch collision. No provider writes or reprocessing.
do $patch$
declare signature text;definition text;needle text;replacement text;original_body text;expected_hash text;
begin
 for signature,needle,replacement in select * from(values
 ('finance_private.capture_fiscal_observation()',
  $n$  'request_payload_hash',md5(coalesce(new.request_payload,'{}')::text),$n$,
  $r$  'authorization_integration_receipt_collision',coalesce(new.doc_type='cte' and nullif(btrim(new.authorization_protocol),'') is not null and btrim(new.authorization_protocol)=nullif(btrim(e#>>'{last_response,document,raw_response_json,managersaas,parsed,lote}'),''),false),
  'request_payload_hash',md5(coalesce(new.request_payload,'{}')::text),$r$),
 ('finance_private.fiscal_receivable_basis_internal(uuid,uuid)',
  $n$ doc_type:=s->>'doc_type';$n$,
  $r$ doc_type:=s->>'doc_type';
 if s->'authorization_integration_receipt_collision'='true'::jsonb then issues:=array_append(issues,'authorization_integration_receipt_collision');end if;$r$)
 ) patches(signature,needle,replacement) loop
 if to_regprocedure(signature) is null then raise exception 'finance_fiscal_collision_dependency_missing: %',signature;end if;
 needle:=replace(needle,E'\r\n',E'\n');replacement:=replace(replacement,E'\r\n',E'\n');
 expected_hash:=case signature when 'finance_private.capture_fiscal_observation()' then 'da41aa6d3e38ff9449dc00a90a4d7346' else '951d7d709816c28a480a0a11f419f630' end;
 select replace(prosrc,E'\r\n',E'\n') into original_body from pg_proc where oid=to_regprocedure(signature);
 original_body:=replace(original_body,replacement,needle);
 if md5(original_body) is distinct from expected_hash then raise exception 'finance_fiscal_collision_body_changed: %',signature;end if;
 definition:=replace(pg_get_functiondef(to_regprocedure(signature)),E'\r\n',E'\n');
 if strpos(definition,replacement)>0 then continue;end if;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'finance_fiscal_collision_source_changed: %',signature;end if;
 execute replace(definition,needle,replacement);
 end loop;
end;$patch$;
