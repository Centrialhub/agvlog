// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const read=(path:string)=>readFileSync(path,'utf8');

describe('linked Storage evidence rollout contract',()=>{
 it('keeps JWT verification and authorizes cleanup with the caller client before admin Storage',()=>{
  const config=read('supabase/config.toml'),index=read('supabase/functions/secure-upload/index.ts');
  expect(config).toMatch(/\[functions\.secure-upload\]\s+verify_jwt = true/);
  expect(index).toContain('callerClient.rpc("authorize_secure_upload_cleanup_v1",args)');
  expect(index).toContain('adminClient.storage.from(targetBucket).remove(targetPaths)');
  expect(index.indexOf('callerClient.rpc("authorize_secure_upload_cleanup_v1",args)')).toBeLessThan(index.indexOf('adminClient.storage.from(targetBucket).remove(targetPaths)'));
 });
 it('closes direct receipt DELETE and protects service-role deletion with a trigger',()=>{
  const sql=read('supabase/migrations/20260901210627_protect_linked_storage_evidence.sql');
  expect(sql).toContain('drop policy if exists receipts_tenant_delete on storage.objects');
  expect(sql).toContain('before delete on storage.objects for each row');
  expect(sql).toContain("raise exception 'storage_evidence_retention_required'");
  expect(sql).toContain('grant execute on function public.authorize_secure_upload_cleanup_v1(uuid,text,text[])\n  to authenticated');
  expect(sql).toContain('from public,anon,authenticated,service_role');
  expect(sql).not.toMatch(/grant execute on function public\.authorize_secure_upload_cleanup_v1[\s\S]*to (anon|service_role)/);
 });
});
