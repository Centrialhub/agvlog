import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=(file:string)=>readFileSync('supabase/migrations/'+file+'.sql','utf8');
function actual(file:string,name:string){const sql=read(file),start=sql.toLowerCase().indexOf('create or replace function '+name+'(');if(start<0)throw Error(name);return sql.slice(start,sql.indexOf('$function$;',start)+11);}
export async function createCanonicalCompanyCompatibilityDatabase(){const db=new PGlite();
 // Reuse only the pre-migration relational shape. No placeholder business
 // writer from the old fixture is installed or invoked by this fixture.
 const fixture=readFileSync('src/test/canonicalDestinationIdempotencyDatabase.test.ts','utf8');const start=fixture.indexOf('`',fixture.indexOf('  await db.exec(`',fixture.indexOf('beforeAll(async')))+1,end=fixture.indexOf('  `);',start);let ddl=fixture.slice(start,end);
 const placeholder=ddl.indexOf('    create function public.resolve_address_queue_item_v1');if(placeholder<0)throw Error('Missing fixture boundary');ddl=ddl.slice(0,placeholder);
 ddl=ddl.replace(/create function public.stop_terminal_statuses\(\)[\s\S]*?\$\$;/,actual('20260824224152_baseline','public.stop_terminal_statuses'));
 ddl=ddl.replace(/create function private.normalized_address_text\([\s\S]*?\$\$;/,actual('20260910192455_complete_address_geocoding_automation','private.normalized_address_text'));
 ddl=ddl.replace(/create function private.normalized_client_address\([\s\S]*?\$\$;/,actual('20260910154838_address_resolution_tracking_operations','private.normalized_client_address'));
 await db.exec(ddl);await db.exec('begin');
 await db.exec("alter table clients add column if not exists address_country_name text;create table public.client_portal_access(user_id uuid,tenant_id uuid,active boolean);create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;");
 // Replace the authentication adapters with current production definitions.
 for(const name of ['user_can_access_tenant','request_tenant_id','is_request_tenant_member']){let fn=actual('20260910131125_active_tenant_auth_context','private.'+name);if(name==='is_request_tenant_member')fn=fn.replace(/\b_tenant_id\b/g,'_tenant');await db.exec(fn);}
 await db.exec(read('20260910140823_require_matching_active_tenant_claim'));
 for(const name of ['is_tenant_admin','is_tenant_operator_or_admin'])await db.exec(actual('20260831164442_remove_authenticator_requirement','public.'+name).replace(/\b_tenant_id\b/g,'_tenant'));
 await db.exec(actual('20260831164442_remove_authenticator_requirement','public.get_user_tenant_ids'));
 // Exact implementation bodies; PostGIS-dependent geometry writer is installed
 // deferred and intentionally not called. Resolution/RLS use their real bodies.
 await db.exec('set local check_function_bodies=off;create schema extensions;');
 for(const [file,name]of [['20260910192455_complete_address_geocoding_automation','public.resolve_address_queue_item_v1'],['20260910142613_driver_geocoding_geofence_tracking','public.upsert_geofence_v2'],['20260910194846_harden_fleet_geofence_editing','public.upsert_geofence_v3'],['20260910142606_driver_trip_cargo_custody_cycle','private.review_trip_cargo_divergence'],['20260910142606_driver_trip_cargo_custody_cycle','public.review_trip_cargo_divergence_v1']])await db.exec(actual(file,name));
 await db.exec('set local check_function_bodies=on');
 for(const signature of ['public.resolve_address_queue_item_v1(jsonb)','public.upsert_geofence_v2(jsonb)','public.upsert_geofence_v3(jsonb)','private.review_trip_cargo_divergence(uuid,uuid,text,text)','public.review_trip_cargo_divergence_v1(uuid,uuid,text,text)'])await db.exec('revoke all on function '+signature+' from public,anon,authenticated,service_role;grant execute on function '+signature+' to authenticated;');
 // Recreate the exact production policy names/expressions observed by SELECT.
 await db.exec(`drop policy "Admins can manage geofences" on geofences;drop policy "Members can view geofences" on geofences;
 create policy agvlog_delete_authenticated on geofences for delete to authenticated using(is_tenant_admin(tenant_id));
 create policy agvlog_insert_authenticated on geofences for insert to authenticated with check(is_tenant_admin(tenant_id));
 create policy agvlog_select_authenticated on geofences for select to authenticated using((tenant_id in(select get_user_tenant_ids())) or is_tenant_admin(tenant_id));
 create policy agvlog_update_authenticated on geofences for update to authenticated using(is_tenant_admin(tenant_id)) with check(is_tenant_admin(tenant_id));`);
 for(const table of ['geofences','geofence_radius_policies','address_resolution_queue'])await db.exec('create policy agvlog_active_tenant_context on '+table+' as restrictive for all to authenticated using(private.is_request_tenant_member(tenant_id)) with check(private.is_request_tenant_member(tenant_id))');
 return db;
}
