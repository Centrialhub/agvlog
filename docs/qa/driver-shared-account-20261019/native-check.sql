\set ON_ERROR_STOP on
begin;
create temp table driver_before as select id,to_jsonb(d)-'user_id' business from public.drivers d;
set local role service_role;
select public.prepare_driver_access_v1('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000005','qa.driver@usuario.com','driver-access-synthetic-nonce-at-least-32-characters-0001');
reset role;
set local role supabase_auth_admin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values(
 '11000000-0000-4000-8000-000000000007','qa.driver@usuario.com',
 '{"agvlog_invite_nonce":"driver-access-synthetic-nonce-at-least-32-characters-0001"}',
 '{"driver_username_managed":true,"driver_access_tenant_id":"21000000-0000-4000-8000-000000000001"}');
reset role;
do $test$ begin
 if (select count(*) from public.drivers where user_id='11000000-0000-4000-8000-000000000007')<>2
   or (select count(*) from public.tenant_memberships where user_id='11000000-0000-4000-8000-000000000007' and role='driver' and active)<>2
   or (select count(*) from public.workspace_memberships where user_id='11000000-0000-4000-8000-000000000007' and role='driver' and active)<>1
   then raise exception 'native_two_company_access_failed';end if;
 if exists(select 1 from driver_before b full join drivers d on d.id=b.id where b.id is null or d.id is null
   or b.business is distinct from to_jsonb(d)-'user_id') then raise exception 'native_registry_changed';end if;
 if exists(select 1 from private.auth_invite_authorizations where email='qa.driver@usuario.com') then raise exception 'native_capability_not_consumed';end if;
 begin
   update drivers set user_id='11000000-0000-4000-8000-000000000007' where id='31000000-0000-4000-8000-000000000003';
   raise exception 'native_unauthorized_extra_link_accepted';
 exception when raise_exception then
   if sqlerrm<>'workspace_driver_link_change_forbidden' then raise;end if;
 end;
end;$test$;
select 'AGV creation: one identity, two driver links, two tenant memberships, one workspace membership; registry unchanged; extra link rejected' native_result;
-- Backend-only cleanup of the exact history-free synthetic identity. Avoid
-- canonical projection during detach; no persistent trigger/guard is changed.
set local session_replication_role=replica;
update drivers set user_id=null where user_id='11000000-0000-4000-8000-000000000007';
delete from tenant_memberships where user_id='11000000-0000-4000-8000-000000000007';
delete from workspace_memberships where user_id='11000000-0000-4000-8000-000000000007';
delete from profiles where id='11000000-0000-4000-8000-000000000007';
delete from auth.users where id='11000000-0000-4000-8000-000000000007';
set local session_replication_role=origin;
do $test$ begin
 if exists(select 1 from driver_before b full join drivers d on d.id=b.id where b.id is null or d.id is null
   or b.business is distinct from to_jsonb(d)-'user_id')
   or exists(select 1 from drivers where user_id='11000000-0000-4000-8000-000000000007')
   or exists(select 1 from auth.users where id='11000000-0000-4000-8000-000000000007')
 then raise exception 'native_test_cleanup_changed_registry';end if;
end;$test$;
select 'Synthetic identity removed; both registries preserved and free' native_result;
rollback;

begin;
set local role service_role;
select public.prepare_driver_access_v1('21000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000006','qa.lira@usuario.com','driver-access-synthetic-nonce-at-least-32-characters-0002');
reset role;
set local role supabase_auth_admin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values(
 '11000000-0000-4000-8000-000000000007','qa.lira@usuario.com',
 '{"agvlog_invite_nonce":"driver-access-synthetic-nonce-at-least-32-characters-0002"}',
 '{"driver_username_managed":true,"driver_access_tenant_id":"21000000-0000-4000-8000-000000000002"}');
reset role;
do $test$ begin
 if (select count(*) from drivers where user_id='11000000-0000-4000-8000-000000000007')<>2 then raise exception 'native_lira_creation_failed';end if;
end;$test$;
select 'LIRA creation: same identity linked to both existing registries' native_result;
rollback;
