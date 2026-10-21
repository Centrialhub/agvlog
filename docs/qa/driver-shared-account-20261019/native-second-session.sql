\set ON_ERROR_STOP on
begin;
set local role supabase_auth_admin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values(
 '11000000-0000-4000-8000-000000000008','qa.concurrent.second@usuario.com',
 '{"agvlog_invite_nonce":"driver-access-synthetic-nonce-at-least-32-characters-0002"}',
 '{"driver_username_managed":true,"driver_access_tenant_id":"21000000-0000-4000-8000-000000000002"}');
commit;
