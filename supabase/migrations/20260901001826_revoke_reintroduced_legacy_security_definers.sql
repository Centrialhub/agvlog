-- Later feature migrations recreated a set of legacy privileged functions
-- after the first ACL hardening pass. None of these signatures is a current
-- browser or Edge API. Pin each body before removing browser execution again.

do $preflight$
declare item record;
begin
  for item in select * from (values
    ('public.audit_data_consistency_v4(uuid)','608605a1af24e10d995356bc74e9a1e8'),
    ('public.audit_operational_congruence_v1(uuid)','9f693bd3d525e9dfe7c5bc9d100a5395'),
    ('public.create_employee_v1(uuid,jsonb)','95452aaac5ee8e75ae563ecf075ea02c'),
    ('public.create_load_with_next_number(uuid,text,text,uuid,uuid,text,text)','f0e304ecd3a18c9f9ec86771c5ddd562'),
    ('public.delete_employee_v1(uuid,uuid)','f8fbbe9515e243b70fe521f38abbfb9c'),
    ('public.delete_load_v1(uuid,uuid)','2baf4288611b4a21ef7d20479f883c8d'),
    ('public.get_driver_workspace_v1(uuid,uuid)','dca8c231888acbc18ce738a36dd459c3'),
    ('public.get_operational_financial_summary_v1(uuid,date,date)','65b403e6b93445bfb62ada2750f62239'),
    ('public.list_employees_v1(uuid,text,text,integer,integer)','ced151d5149741311c95e743bff56a00'),
    ('public.log_operational_event_v2(uuid,text,uuid,uuid,jsonb,jsonb,text)','ef03d05bdb51cb1bdb561f17d2e1a915'),
    ('public.move_load_items_v3(uuid,uuid,uuid,uuid[])','f86dc4eae120912bb8d981997898b3e7'),
    ('public.update_employee_v1(uuid,uuid,jsonb,integer)','18c3149440475e33ad78bddcbc8ac645'),
    ('public.update_load_v1(uuid,uuid,jsonb,integer)','61dd66c634ed8c3d5883800e3bd472ec')
  ) contracts(signature,definition_md5)
  loop
    if md5(replace(
      pg_get_functiondef(to_regprocedure(item.signature)),
      E'\r\n', E'\n'
    )) is distinct from item.definition_md5 then
      raise exception 'Legacy privileged function changed: %', item.signature;
    end if;
  end loop;
end;
$preflight$;

revoke all privileges on function
  public.audit_data_consistency_v4(uuid),
  public.audit_operational_congruence_v1(uuid),
  public.create_employee_v1(uuid,jsonb),
  public.create_load_with_next_number(uuid,text,text,uuid,uuid,text,text),
  public.delete_employee_v1(uuid,uuid),
  public.delete_load_v1(uuid,uuid),
  public.get_driver_workspace_v1(uuid,uuid),
  public.get_operational_financial_summary_v1(uuid,date,date),
  public.list_employees_v1(uuid,text,text,integer,integer),
  public.log_operational_event_v2(uuid,text,uuid,uuid,jsonb,jsonb,text),
  public.move_load_items_v3(uuid,uuid,uuid,uuid[]),
  public.update_employee_v1(uuid,uuid,jsonb,integer),
  public.update_load_v1(uuid,uuid,jsonb,integer)
from public, anon, authenticated;

